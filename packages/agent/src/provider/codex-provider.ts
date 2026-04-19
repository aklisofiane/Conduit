import type {
  AgentEvent,
  AgentRequest,
  ProviderCapabilities,
  ResolvedMcpServer,
} from '@conduit/shared';
import { applyCounters, checkConstraints, newCounters } from './constraints';
import type { AgentProvider } from './types';

/**
 * CodexProvider wraps `@openai/codex-sdk`. Same contract as ClaudeProvider
 * — translate `AgentRequest` to the SDK and stream-map its events into our
 * `AgentEvent` union.
 *
 * Two Codex-isms worth calling out:
 *
 *   1. MCP servers are configured on the `Codex` instance, not per-turn.
 *      We construct a fresh instance per call, passing the resolved MCP
 *      configs via `options.config.mcp_servers`. Secrets were already
 *      substituted upstream by `resolveMcpServers`.
 *
 *   2. The SDK doesn't emit character-level text deltas — it emits full
 *      message text on `item.updated` / `item.completed`. We diff against
 *      the last text we saw for each item id so downstream consumers still
 *      get incremental `text` events.
 */
export class CodexProvider implements AgentProvider {
  readonly id = 'codex' as const;

  constructor(private readonly opts: { apiKey?: string } = {}) {}

  getCapabilities(): ProviderCapabilities {
    return {
      models: ['gpt-5-codex'],
      maxTokens: 200_000,
      supportsMcp: true,
    };
  }

  async *execute(req: AgentRequest, signal: AbortSignal): AsyncIterable<AgentEvent> {
    const { Codex } = await loadCodexSdk();
    const codex = new Codex({
      apiKey: this.opts.apiKey,
      config: buildConfigOverrides(req.mcpServers),
    });

    const thread = codex.startThread({
      model: req.model,
      workingDirectory: req.workspacePath,
      // SDK defaults (read-only) are incompatible with repo-clone / ticket-branch
      // workflows where the agent is expected to commit and edit.
      sandboxMode: 'workspace-write',
      skipGitRepoCheck: true,
      approvalPolicy: 'never',
    });

    const input = `<system>\n${req.systemPrompt}\n</system>\n\n${req.userMessage}`;
    const { events } = await thread.runStreamed(input, { signal });

    const seenText = new Map<string, string>();
    const openToolCalls = new Set<string>();

    const counters = newCounters();
    const startedAt = Date.now();
    const check = (): void => checkConstraints(req, counters, startedAt);

    for await (const raw of events) {
      if (signal.aborted) return;
      const translated = translate(raw, seenText, openToolCalls);
      for (const event of translated) {
        applyCounters(event, counters);
        check();
        yield event;
        if (event.type === 'done') return;
      }
    }
  }
}

interface CodexThread {
  runStreamed(
    input: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ events: AsyncIterable<unknown> }>;
}
interface CodexInstance {
  startThread(options?: Record<string, unknown>): CodexThread;
}
interface CodexSdkModule {
  Codex: new (options?: Record<string, unknown>) => CodexInstance;
}

let _sdk: CodexSdkModule | undefined;
let _loader: (() => Promise<CodexSdkModule>) | undefined;

async function loadCodexSdk(): Promise<CodexSdkModule> {
  if (_sdk) return _sdk;
  if (_loader) {
    _sdk = await _loader();
    return _sdk;
  }
  const mod = (await import('@openai/codex-sdk').catch((err: unknown) => {
    throw new Error(
      `@openai/codex-sdk is not installed. Install it in the worker app. Original: ${String(err)}`,
    );
  })) as CodexSdkModule;
  _sdk = mod;
  return mod;
}

/**
 * Test-only: inject a custom SDK loader and reset the cached module. Keeps
 * the unit test in this package from needing a real Codex binary.
 */
export function __setCodexSdkLoaderForTests(
  loader: (() => Promise<CodexSdkModule>) | undefined,
): void {
  _loader = loader;
  _sdk = undefined;
}

/**
 * The Codex CLI consumes MCP config via TOML-flattened `--config` overrides.
 * The SDK's `config` option accepts a nested object and flattens it.
 * Shape mirrors Codex's `mcp_servers.<name> = { ... }` config block.
 */
function buildConfigOverrides(
  mcpServers: readonly ResolvedMcpServer[],
): Record<string, unknown> | undefined {
  if (mcpServers.length === 0) return undefined;
  const entries: Record<string, unknown> = {};
  for (const s of mcpServers) {
    entries[s.id] = serverToCodexConfig(s);
  }
  return { mcp_servers: entries };
}

function serverToCodexConfig(server: ResolvedMcpServer): Record<string, unknown> {
  const t = server.transport;
  if (t.kind === 'stdio') {
    return {
      command: t.command,
      ...(t.args?.length ? { args: t.args } : {}),
      ...(t.env && Object.keys(t.env).length ? { env: t.env } : {}),
    };
  }
  // Codex supports remote MCP servers via the `url` form. Header injection
  // for SSE/HTTP isn't documented on the SDK surface; we pass the URL and
  // let the transport carry the auth if headers are already substituted.
  return {
    url: t.url,
    ...(t.headers && Object.keys(t.headers).length ? { headers: t.headers } : {}),
  };
}

/**
 * Translate one SDK `ThreadEvent` into zero or more `AgentEvent`s. Mutates
 * `seenText` / `openToolCalls` to compute incremental text deltas and
 * pair-up tool call/result events.
 */
function translate(
  raw: unknown,
  seenText: Map<string, string>,
  openToolCalls: Set<string>,
): AgentEvent[] {
  if (!raw || typeof raw !== 'object') return [];
  const ev = raw as {
    type?: string;
    item?: { id?: string; type?: string } & Record<string, unknown>;
    usage?: { input_tokens?: number; output_tokens?: number };
    error?: { message?: string } | string;
    message?: string;
  };

  switch (ev.type) {
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      return translateItemEvent(ev, seenText, openToolCalls);

    case 'turn.completed': {
      const events: AgentEvent[] = [];
      if (ev.usage) {
        events.push({
          type: 'usage',
          inputTokens: ev.usage.input_tokens ?? 0,
          outputTokens: ev.usage.output_tokens ?? 0,
        });
      }
      events.push({ type: 'done' });
      return events;
    }

    case 'turn.failed': {
      const message =
        typeof ev.error === 'object' && ev.error?.message
          ? ev.error.message
          : 'Codex turn failed';
      throw new Error(message);
    }

    case 'error': {
      const message = typeof ev.message === 'string' ? ev.message : 'Codex stream error';
      throw new Error(message);
    }

    default:
      return [];
  }
}

function translateItemEvent(
  ev: {
    type?: string;
    item?: { id?: string; type?: string } & Record<string, unknown>;
  },
  seenText: Map<string, string>,
  openToolCalls: Set<string>,
): AgentEvent[] {
  const item = ev.item;
  if (!item?.id || !item.type) return [];
  const id = item.id;

  if (item.type === 'agent_message') {
    const full = typeof item.text === 'string' ? item.text : '';
    const prior = seenText.get(id) ?? '';
    const delta = full.startsWith(prior) ? full.slice(prior.length) : full;
    if (delta.length === 0) return [];
    seenText.set(id, full);
    return [{ type: 'text', delta }];
  }

  if (item.type === 'mcp_tool_call') {
    const status = typeof item.status === 'string' ? item.status : undefined;
    const name = `${String(item.server ?? 'mcp')}.${String(item.tool ?? '')}`;
    if (status === 'in_progress' && !openToolCalls.has(id)) {
      openToolCalls.add(id);
      return [{ type: 'tool_call', id, name, input: item.arguments ?? {} }];
    }
    if (status === 'completed' || status === 'failed') {
      openToolCalls.delete(id);
      const error = extractMcpError(item);
      return [
        {
          type: 'tool_result',
          id,
          output: item.result ?? (error ?? ''),
          error,
        },
      ];
    }
    return [];
  }

  if (item.type === 'command_execution') {
    const status = typeof item.status === 'string' ? item.status : undefined;
    if (status === 'in_progress' && !openToolCalls.has(id)) {
      openToolCalls.add(id);
      return [
        {
          type: 'tool_call',
          id,
          name: 'bash',
          input: { command: item.command ?? '' },
        },
      ];
    }
    if (status === 'completed' || status === 'failed') {
      openToolCalls.delete(id);
      const output = typeof item.aggregated_output === 'string' ? item.aggregated_output : '';
      const error =
        status === 'failed'
          ? `exit ${typeof item.exit_code === 'number' ? item.exit_code : 'unknown'}`
          : undefined;
      return [{ type: 'tool_result', id, output, error }];
    }
    return [];
  }

  return [];
}

function extractMcpError(item: Record<string, unknown>): string | undefined {
  const err = item.error;
  if (err && typeof err === 'object') {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  if (item.status === 'failed') return 'MCP tool call failed';
  return undefined;
}
