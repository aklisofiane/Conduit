import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AgentEvent,
  AgentProviderId,
  AgentRequest,
  ProviderCapabilities,
} from '@conduit/shared';
import { applyCounters, checkConstraints, newCounters } from './constraints';
import type { AgentProvider } from './types';

/**
 * A single step in a stub script. Most kinds map 1:1 to `AgentEvent`;
 * `write-file` performs a real filesystem write inside the workspace before
 * the next event fires, so tests exercise the real workspace + cleanup paths
 * without pretending to hold an SDK built-in tool. `delay` emits nothing.
 */
export type StubScriptStep =
  | { kind: 'text'; delta: string; delayMs?: number }
  | { kind: 'tool_call'; id: string; name: string; input?: unknown; delayMs?: number }
  | {
      kind: 'tool_result';
      id: string;
      output: unknown;
      error?: string;
      delayMs?: number;
    }
  | {
      kind: 'usage';
      inputTokens: number;
      outputTokens: number;
      delayMs?: number;
    }
  | { kind: 'done'; delayMs?: number }
  | { kind: 'write-file'; path: string; content: string; delayMs?: number }
  | { kind: 'delay'; ms: number };

export interface StubScript {
  steps: StubScriptStep[];
  /** Applied when a step omits its own `delayMs`. Default 0. */
  stepDelayMs?: number;
}

const scriptQueue: StubScript[] = [];

/** Queue a script for the next `StubProvider.execute()` call (FIFO). */
export function queueStubScript(script: StubScript): void {
  scriptQueue.push(script);
}

/** Reset queued scripts — safe to call in test teardown. */
export function clearStubScripts(): void {
  scriptQueue.length = 0;
}

/**
 * Replays scripted events instead of calling a real LLM. Real tool execution
 * stays in scope via `write-file` steps — the stub only replaces the
 * LLM loop. See docs/VALIDATION.md.
 *
 * Scripts are sourced in priority order:
 *   1. In-process queue (`queueStubScript()`) — FIFO, one script per run.
 *   2. `CONDUIT_STUB_SCRIPT` env var — JSON file read fresh per `execute()`,
 *      so the E2E harness can rewrite it between runs while the worker stays
 *      up.
 */
export class StubProvider implements AgentProvider {
  readonly id: AgentProviderId;

  constructor(id: AgentProviderId = 'claude') {
    this.id = id;
  }

  getCapabilities(): ProviderCapabilities {
    return { models: ['stub-model'], maxTokens: 1_000_000, supportsMcp: true };
  }

  async *execute(req: AgentRequest, signal: AbortSignal): AsyncIterable<AgentEvent> {
    const script = await loadScript();
    const startedAt = Date.now();
    const counters = newCounters();

    for (const step of script.steps) {
      if (signal.aborted) return;

      if (step.kind === 'delay') {
        await sleep(step.ms, signal);
        continue;
      }

      const delay = step.delayMs ?? script.stepDelayMs ?? 0;
      if (delay > 0) await sleep(delay, signal);
      if (signal.aborted) return;

      if (step.kind === 'write-file') {
        const target = path.isAbsolute(step.path)
          ? step.path
          : path.join(req.workspacePath, step.path);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, step.content, 'utf8');
        continue;
      }

      const event = toEvent(step);
      applyCounters(event, counters);
      checkConstraints(req, counters, startedAt);
      yield event;
      if (event.type === 'done') return;
    }
  }
}

function toEvent(step: StubScriptStep): AgentEvent {
  switch (step.kind) {
    case 'text':
      return { type: 'text', delta: step.delta };
    case 'tool_call':
      return { type: 'tool_call', id: step.id, name: step.name, input: step.input ?? {} };
    case 'tool_result':
      return {
        type: 'tool_result',
        id: step.id,
        output: step.output,
        error: step.error,
      };
    case 'usage':
      return {
        type: 'usage',
        inputTokens: step.inputTokens,
        outputTokens: step.outputTokens,
      };
    case 'done':
      return { type: 'done' };
    case 'write-file':
    case 'delay':
      throw new Error(`Step kind ${step.kind} does not emit an event`);
  }
}

async function loadScript(): Promise<StubScript> {
  const queued = scriptQueue.shift();
  if (queued) return queued;
  const file = process.env.CONDUIT_STUB_SCRIPT;
  if (!file) {
    throw new Error(
      'StubProvider has no script to replay. Call queueStubScript() or set CONDUIT_STUB_SCRIPT.',
    );
  }
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw) as StubScript;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
