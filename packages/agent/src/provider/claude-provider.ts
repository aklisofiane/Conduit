import type { AgentEvent, AgentRequest, ProviderCapabilities } from '@conduit/shared';
import { ConstraintExceededError } from '../errors/index';
import type { AgentProvider } from './types';

/**
 * ClaudeProvider wraps `@anthropic-ai/claude-agent-sdk`. Deliberately kept as
 * a thin adapter — no retries, no MCP lifecycle, no credential handling.
 *
 * The SDK is loaded dynamically so this package stays usable in environments
 * where it isn't installed (tests that only use `StubProvider`, schema tools,
 * type-only consumers). The module is resolved on first `execute()` call.
 */
export class ClaudeProvider implements AgentProvider {
  readonly id = 'claude' as const;

  constructor(private readonly opts: { apiKey?: string } = {}) {}

  getCapabilities(): ProviderCapabilities {
    return {
      models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
      maxTokens: 200_000,
      supportsMcp: true,
    };
  }

  async *execute(req: AgentRequest, signal: AbortSignal): AsyncIterable<AgentEvent> {
    const sdk = await loadClaudeSdk();
    const mcpServers = Object.fromEntries(
      req.mcpServers.map((s) => [s.id, sdkMcpConfig(s)]),
    );

    const startedAt = Date.now();
    const counters = { turns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0 };
    const check = () => checkConstraints(req, counters, startedAt);

    const iter = sdk.query({
      prompt: req.userMessage,
      options: {
        model: req.model,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: req.systemPrompt },
        cwd: req.workspacePath,
        mcpServers,
        maxTurns: req.constraints.maxTurns,
        abortController: abortControllerFromSignal(signal),
        includePartialMessages: true,
      },
    });

    for await (const raw of iter) {
      if (signal.aborted) return;
      const events = translate(raw);
      for (const event of events) {
        applyCounters(event, counters);
        check();
        yield event;
        if (event.type === 'done') return;
      }
    }
  }
}

type ClaudeSdk = {
  query(args: unknown): AsyncIterable<unknown>;
};

let _sdk: ClaudeSdk | undefined;

async function loadClaudeSdk(): Promise<ClaudeSdk> {
  if (_sdk) return _sdk;
  const mod: unknown = await import('@anthropic-ai/claude-agent-sdk').catch((err: unknown) => {
    throw new Error(
      `@anthropic-ai/claude-agent-sdk is not installed. Install it in the worker app. Original: ${String(err)}`,
    );
  });
  _sdk = mod as ClaudeSdk;
  return _sdk;
}

/** Map our ResolvedMcpServer shape into the SDK's expected config shape. */
function sdkMcpConfig(server: AgentRequest['mcpServers'][number]): unknown {
  const t = server.transport;
  if (t.kind === 'stdio') {
    return { type: 'stdio', command: t.command, args: t.args ?? [], env: t.env ?? {} };
  }
  if (t.kind === 'sse') {
    return { type: 'sse', url: t.url, headers: t.headers ?? {} };
  }
  return { type: 'http', url: t.url, headers: t.headers ?? {} };
}

function abortControllerFromSignal(signal: AbortSignal): AbortController {
  const ctrl = new AbortController();
  if (signal.aborted) ctrl.abort();
  else signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  return ctrl;
}

/**
 * Best-effort translation from SDK stream messages to our `AgentEvent` union.
 * The SDK emits a discriminated shape (`type: 'assistant' | 'user' | 'result' | 'stream_event' | 'system' | 'partial_assistant_message_start'`).
 * We keep this resilient — unknown shapes become no-ops.
 */
function translate(raw: unknown): AgentEvent[] {
  if (!raw || typeof raw !== 'object') return [];
  const m = raw as { type?: string; message?: unknown; event?: unknown; subtype?: string };

  if (m.type === 'stream_event' && m.event && typeof m.event === 'object') {
    const ev = m.event as { type?: string; delta?: { type?: string; text?: string } };
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
      return [{ type: 'text', delta: ev.delta.text }];
    }
    return [];
  }

  if (m.type === 'assistant' && m.message && typeof m.message === 'object') {
    const msg = m.message as {
      content?: Array<{ type?: string; id?: string; name?: string; input?: unknown }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const events: AgentEvent[] = [];
    for (const block of msg.content ?? []) {
      if (block.type === 'tool_use' && block.id && block.name) {
        events.push({
          type: 'tool_call',
          id: block.id,
          name: block.name,
          input: block.input ?? {},
        });
      }
    }
    if (msg.usage) {
      events.push({
        type: 'usage',
        inputTokens: msg.usage.input_tokens ?? 0,
        outputTokens: msg.usage.output_tokens ?? 0,
      });
    }
    return events;
  }

  if (m.type === 'user' && m.message && typeof m.message === 'object') {
    const msg = m.message as {
      content?: Array<{
        type?: string;
        tool_use_id?: string;
        content?: unknown;
        is_error?: boolean;
      }>;
    };
    const events: AgentEvent[] = [];
    for (const block of msg.content ?? []) {
      if (block.type === 'tool_result' && block.tool_use_id) {
        events.push({
          type: 'tool_result',
          id: block.tool_use_id,
          output: block.content ?? '',
          error: block.is_error ? stringifyOutput(block.content) : undefined,
        });
      }
    }
    return events;
  }

  if (m.type === 'result') {
    return [{ type: 'done' }];
  }

  return [];
}

function stringifyOutput(c: unknown): string {
  if (typeof c === 'string') return c;
  try {
    return JSON.stringify(c);
  } catch {
    return String(c);
  }
}

function applyCounters(
  event: AgentEvent,
  counters: { turns: number; toolCalls: number; inputTokens: number; outputTokens: number },
): void {
  if (event.type === 'tool_call') counters.toolCalls += 1;
  if (event.type === 'usage') {
    counters.inputTokens += event.inputTokens;
    counters.outputTokens += event.outputTokens;
    counters.turns += 1;
  }
}

function checkConstraints(
  req: AgentRequest,
  counters: { turns: number; toolCalls: number; inputTokens: number; outputTokens: number },
  startedAt: number,
): void {
  const c = req.constraints;
  if (c.maxTurns && counters.turns > c.maxTurns) {
    throw new ConstraintExceededError('maxTurns', c.maxTurns, counters.turns);
  }
  if (c.maxToolCalls && counters.toolCalls > c.maxToolCalls) {
    throw new ConstraintExceededError('maxToolCalls', c.maxToolCalls, counters.toolCalls);
  }
  if (c.maxTokens) {
    const total = counters.inputTokens + counters.outputTokens;
    if (total > c.maxTokens) {
      throw new ConstraintExceededError('maxTokens', c.maxTokens, total);
    }
  }
  if (c.timeoutSec) {
    const elapsed = (Date.now() - startedAt) / 1000;
    if (elapsed > c.timeoutSec) {
      throw new ConstraintExceededError('timeoutSec', c.timeoutSec, Math.floor(elapsed));
    }
  }
}
