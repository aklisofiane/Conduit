import { randomBytes } from 'node:crypto';
import {
  PROVIDER_MODELS,
  type AgentEvent,
  type AgentRequest,
  type ProviderCapabilities,
  type ResolvedMcpServer,
} from '@conduit/shared';
import { applyCounters, checkConstraints, newCounters } from './constraints';
import type { AgentProvider, AgentSession } from './types';

/**
 * CodexProvider wraps `@openai/codex-sdk`. Same contract as ClaudeProvider
 * — translate `AgentRequest` to the SDK and stream-map its events into our
 * `AgentEvent` union.
 *
 * Sessions are 1:1 with Codex threads — `startThread()` creates the thread;
 * each `AgentSession.run(userMessage)` invokes `thread.runStreamed()` for one
 * turn. The system prompt is prepended to the first turn's input only; Codex
 * threads retain conversation history across `runStreamed()` calls, so we
 * don't repeat the system block on later turns (e.g. the final `.conduit/`
 * summary prompt).
 *
 * Two Codex-isms worth calling out:
 *
 *   1. MCP servers are configured on the `Codex` instance, not per-turn.
 *      Resolved configs are passed via `options.config.mcp_servers`. Secrets
 *      were already substituted upstream by `resolveMcpServers`.
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
      models: [...PROVIDER_MODELS.codex],
      maxTokens: 200_000,
      supportsMcp: true,
    };
  }

  startSession(req: AgentRequest, signal: AbortSignal): AgentSession {
    const counters = newCounters();
    const startedAt = Date.now();
    const seenText = new Map<string, string>();
    const openToolCalls = new Set<string>();
    const todoSnapshots = new Map<string, number>();
    const plan = planCodexConfig(req.mcpServers);
    let thread: CodexThread | undefined;
    let firstTurn = true;

    const ensureThread = async (): Promise<CodexThread> => {
      if (thread) return thread;
      // Apply env bindings here (not in startSession) so a session that's
      // never run leaves no process.env entries behind. The activity wraps
      // the first run() in a try/finally that calls dispose, so writes are
      // guaranteed to be cleaned up.
      for (const { key, value } of plan.envBindings) process.env[key] = value;
      const { Codex } = await loadCodexSdk();
      const codex = new Codex({
        apiKey: this.opts.apiKey,
        config: plan.config,
      });
      thread = codex.startThread({
        model: req.model,
        workingDirectory: req.workspacePath,
        // SDK defaults (read-only) are incompatible with repo-clone / ticket-branch
        // workflows where the agent is expected to commit and edit.
        sandboxMode: 'workspace-write',
        skipGitRepoCheck: true,
        approvalPolicy: 'never',
        // Cached mode reuses prior search results when available; live mode
        // pays per-fetch cost. Start with cached — promote to live behind a
        // toggle if research workflows need fresh hits.
        webSearchMode: req.webSearch ? 'cached' : 'disabled',
      });
      return thread;
    };

    const run = async function* (userMessage: string): AsyncIterable<AgentEvent> {
      if (signal.aborted) return;
      const t = await ensureThread();
      const input = firstTurn
        ? `<system>\n${req.systemPrompt}\n</system>\n\n${userMessage}`
        : userMessage;
      firstTurn = false;

      const { events } = await t.runStreamed(input, { signal });
      for await (const raw of events) {
        if (signal.aborted) return;
        const translated = translate(raw, seenText, openToolCalls, todoSnapshots);
        for (const event of translated) {
          applyCounters(event, counters);
          checkConstraints(req, counters, startedAt);
          yield event;
          if (event.type === 'done') return;
        }
      }
    };

    const dispose = (): void => {
      // Codex SDK has no explicit thread teardown — dropping the reference
      // is sufficient. Kept for symmetry with other providers.
      thread = undefined;
      for (const { key } of plan.envBindings) delete process.env[key];
    };

    return { run, dispose };
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

interface EnvBinding {
  key: string;
  value: string;
}

/**
 * Plans the Codex SDK `config` block for the given MCP servers, plus any
 * env-var bindings the caller must apply before constructing the SDK.
 *
 * Codex's remote-MCP transport accepts auth only via `bearer_token_env_var`
 * (not inline headers), so a `Bearer <token>` header gets stashed under a
 * unique env-var name and the name is passed through `bearer_token_env_var`.
 * Bindings are returned rather than applied so callers control the lifetime
 * (apply right before SDK construction; delete on dispose).
 */
function planCodexConfig(mcpServers: readonly ResolvedMcpServer[]): {
  config: Record<string, unknown> | undefined;
  envBindings: EnvBinding[];
} {
  if (mcpServers.length === 0) return { config: undefined, envBindings: [] };
  const sessionNonce = randomBytes(4).toString('hex').toUpperCase();
  const entries: Record<string, unknown> = {};
  const envBindings: EnvBinding[] = [];
  for (const [index, server] of mcpServers.entries()) {
    const envPrefix = `CONDUIT_CODEX_MCP_${sessionNonce}_${index}_${sanitizeEnvPart(server.id)}`;
    const planned = planServer(server, envPrefix);
    entries[server.id] = planned.config;
    if (planned.envBinding) envBindings.push(planned.envBinding);
  }
  return { config: { mcp_servers: entries }, envBindings };
}

function planServer(
  server: ResolvedMcpServer,
  envPrefix: string,
): { config: Record<string, unknown>; envBinding?: EnvBinding } {
  const common = {
    ...(server.allowedTools?.length ? { enabled_tools: server.allowedTools } : {}),
    default_tools_approval_mode: 'approve' as const,
  };
  const t = server.transport;
  if (t.kind === 'stdio') {
    return {
      config: {
        command: t.command,
        ...(t.args?.length ? { args: t.args } : {}),
        ...(t.env && Object.keys(t.env).length ? { env: t.env } : {}),
        ...common,
      },
    };
  }
  const bearer = extractBearer(t.headers, envPrefix);
  return {
    config: {
      url: t.url,
      ...(bearer.headers && Object.keys(bearer.headers).length ? { headers: bearer.headers } : {}),
      ...(bearer.envBinding ? { bearer_token_env_var: bearer.envBinding.key } : {}),
      ...common,
    },
    envBinding: bearer.envBinding,
  };
}

function extractBearer(
  headers: Record<string, string> | undefined,
  envPrefix: string,
): { headers: Record<string, string> | undefined; envBinding?: EnvBinding } {
  if (!headers) return { headers };
  const authKey = Object.keys(headers).find((k) => k.toLowerCase() === 'authorization');
  const match = authKey ? headers[authKey]?.match(/^Bearer\s+(.+)$/i) : undefined;
  if (!authKey || !match) return { headers };
  const { [authKey]: _drop, ...rest } = headers;
  return {
    headers: Object.keys(rest).length ? rest : undefined,
    envBinding: { key: `${envPrefix}_BEARER_TOKEN`, value: match[1]! },
  };
}

function sanitizeEnvPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
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
  todoSnapshots: Map<string, number>,
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
      return translateItemEvent(ev, seenText, openToolCalls, todoSnapshots);

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
        typeof ev.error === 'object' && ev.error?.message ? ev.error.message : 'Codex turn failed';
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
  todoSnapshots: Map<string, number>,
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
          output: item.result ?? error ?? '',
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

  // `web_search` items have no `status` field — they fire item.started when
  // dispatched and item.completed when results return to the agent. Results
  // themselves arrive via the agent's reasoning/messages; we surface only
  // the query so the timeline shows the search happened.
  if (item.type === 'web_search') {
    const query = typeof item.query === 'string' ? item.query : '';
    if (ev.type === 'item.started' && !openToolCalls.has(id)) {
      openToolCalls.add(id);
      return [{ type: 'tool_call', id, name: 'web_search', input: { query } }];
    }
    if (ev.type === 'item.completed') {
      openToolCalls.delete(id);
      return [{ type: 'tool_result', id, output: query }];
    }
    return [];
  }

  // `file_change` is emitted once per patch on item.completed (the SDK never
  // surfaces in-progress patches). Codex applies the patch atomically and
  // tells us only `{path, kind}` per change — no content or diff. We map
  // each change onto the Write/Edit/Delete tool name the UI already
  // pretty-prints (apps/web/src/components/run/tool-summary.ts), so bulk
  // patches collapse into `× N Write calls` via the timeline's same-tool
  // grouping.
  if (item.type === 'file_change') {
    if (ev.type !== 'item.completed') return [];
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const failed = item.status === 'failed';
    const out: AgentEvent[] = [];
    changes.forEach((c, idx) => {
      const change = c as { path?: unknown; kind?: unknown };
      const path = typeof change.path === 'string' ? change.path : '';
      const kind = typeof change.kind === 'string' ? change.kind : '';
      const name = kind === 'add' ? 'Write' : kind === 'delete' ? 'Delete' : 'Edit';
      const childId = `${id}:${idx}`;
      out.push({ type: 'tool_call', id: childId, name, input: { file_path: path } });
      out.push({
        type: 'tool_result',
        id: childId,
        output: failed ? 'patch failed' : kind,
        ...(failed ? { error: 'patch failed' } : {}),
      });
    });
    return out;
  }

  // `todo_list` lifecycle: item.started (often empty) → item.updated (any
  // number) → item.completed. We skip `item.started` and treat each later
  // emission as a fresh TodoWrite snapshot, matching how Claude's TodoWrite
  // already renders. Synthesised ids prevent the UI from coalescing distinct
  // snapshots into a single tool row.
  if (item.type === 'todo_list') {
    if (ev.type === 'item.started') return [];
    const items = Array.isArray(item.items) ? item.items : [];
    const todos = items
      .map((entry) => {
        const t = entry as { text?: unknown; completed?: unknown };
        if (typeof t.text !== 'string') return undefined;
        return { content: t.text, status: t.completed ? 'completed' : 'pending' };
      })
      .filter((t): t is { content: string; status: string } => t !== undefined);
    const seq = (todoSnapshots.get(id) ?? 0) + 1;
    todoSnapshots.set(id, seq);
    const childId = `${id}:${seq}`;
    return [
      { type: 'tool_call', id: childId, name: 'TodoWrite', input: { todos } },
      { type: 'tool_result', id: childId, output: `${todos.length} todos` },
    ];
  }

  // Item-level non-fatal errors. Surfaced as a paired tool_call/tool_result
  // with `error` set so the UI's StatusPill renders them red. Stream-level
  // `error` events and `turn.failed` keep the throw-and-terminate behaviour
  // upstream in `translate`.
  if (item.type === 'error') {
    if (ev.type !== 'item.completed') return [];
    const message = typeof item.message === 'string' ? item.message : 'Codex error';
    return [
      { type: 'tool_call', id, name: 'codex.error', input: { message } },
      { type: 'tool_result', id, output: message, error: message },
    ];
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
