import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AgentEvent,
  AgentProviderId,
  AgentRequest,
  ProviderCapabilities,
} from '@conduit/shared';
import { applyCounters, checkConstraints, newCounters } from './constraints';
import type { AgentProvider, AgentSession } from './types';

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

/**
 * A sequence of turns replayed by a single `AgentSession`. Each call to
 * `AgentSession.run()` consumes one entry from `turns`; once exhausted,
 * subsequent `run()` calls emit a bare `done` event so tests that only care
 * about the main turn don't have to script the summary turn.
 */
export interface StubSessionScript {
  turns: StubScript[];
}

/**
 * Multiple sessions packed into one file/queue for multi-node tests.
 *
 * - `sessions`: walked FIFO, one entry per `startSession()`. Simplest, but
 *   relies on deterministic order across parallel nodes (not reliable).
 * - `byPrompt`: a session is selected by the first rule whose `match`
 *   substring appears in the session's `systemPrompt` (i.e. the agent
 *   node's `instructions`). Works for parallel groups where start order
 *   isn't deterministic — tests tag each node's instructions with a unique
 *   keyword and dispatch from there.
 *
 * When both are set, `byPrompt` wins; FIFO is the fallback when no rule
 * matches.
 */
export interface StubSessionBundle {
  sessions?: StubSessionScript[];
  byPrompt?: Array<{ match: string; session: StubSessionScript }>;
}

const sessionQueue: StubSessionScript[] = [];
interface EnvBundleState {
  file: string;
  queue: StubSessionScript[];
  byPrompt: Array<{ match: string; session: StubSessionScript }>;
}
let envBundleCursor: EnvBundleState | undefined;

/** Queue a multi-turn session for the next `StubProvider.startSession()` (FIFO). */
export function queueStubSession(session: StubSessionScript): void {
  sessionQueue.push(session);
}

/** Back-compat: queue a single-turn session. */
export function queueStubScript(script: StubScript): void {
  sessionQueue.push({ turns: [script] });
}

/** Reset queued scripts — safe to call in test teardown. */
export function clearStubScripts(): void {
  sessionQueue.length = 0;
  envBundleCursor = undefined;
}

/**
 * Replays scripted events instead of calling a real LLM. Real tool execution
 * stays in scope via `write-file` steps — the stub only replaces the
 * LLM loop. See docs/VALIDATION.md.
 *
 * Scripts are sourced in priority order on `startSession()`:
 *   1. In-process queue (`queueStubSession()` / `queueStubScript()`) — FIFO.
 *   2. `CONDUIT_STUB_SCRIPT` env var — JSON file read fresh per session, so
 *      the E2E harness can rewrite it between runs while the worker stays up.
 *      File may be a `StubSessionScript` (`{ turns: [...] }`) or a bare
 *      `StubScript` (back-compat: treated as a single-turn session).
 */
export class StubProvider implements AgentProvider {
  readonly id: AgentProviderId;

  constructor(id: AgentProviderId = 'claude') {
    this.id = id;
  }

  getCapabilities(): ProviderCapabilities {
    return { models: ['stub-model'], maxTokens: 1_000_000, supportsMcp: true };
  }

  startSession(req: AgentRequest, signal: AbortSignal): AgentSession {
    const counters = newCounters();
    const startedAt = Date.now();
    let turns: StubScript[] | undefined;
    const getTurns = async (): Promise<StubScript[]> => {
      if (turns) return turns;
      turns = await loadSessionTurns(req.systemPrompt);
      return turns;
    };

    const run = async function* (_userMessage: string): AsyncIterable<AgentEvent> {
      if (signal.aborted) return;
      const queue = await getTurns();
      const script = queue.shift();
      if (!script) {
        // Exhausted — emit a bare done so the caller's turn completes. This
        // lets tests script just the main turn; the final-summary turn
        // auto-completes and the placeholder `.conduit/<Node>.md` fallback
        // takes over.
        yield { type: 'done' };
        return;
      }

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
      // No explicit `done` in the script — synthesize one so the session run
      // completes cleanly.
      yield { type: 'done' };
    };

    const dispose = (): void => {
      // Nothing to clean up — script buffer is GC'd with the closure.
    };

    return { run, dispose };
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

async function loadSessionTurns(systemPrompt: string): Promise<StubScript[]> {
  const queued = sessionQueue.shift();
  if (queued) return [...queued.turns];
  const file = process.env.CONDUIT_STUB_SCRIPT;
  if (!file) {
    throw new Error(
      'StubProvider has no script to replay. Call queueStubSession() / queueStubScript(), or set CONDUIT_STUB_SCRIPT.',
    );
  }

  // Reload when the bundle rule set hasn't been cached (or is for a
  // different file path). Re-reads are cheap — the harness rewrites this
  // file between test scenarios.
  if (!envBundleCursor || envBundleCursor.file !== file) {
    await reloadEnvBundle(file);
  }

  // Prompt-matched routing wins when a rule matches — this is the reliable
  // dispatch for parallel groups where `startSession` order isn't
  // deterministic. Rules don't consume on match (multiple nodes may share
  // the same session shape), keeping the dispatch order-free.
  const match = envBundleCursor!.byPrompt.find((rule) => systemPrompt.includes(rule.match));
  if (match) return [...match.session.turns];

  // FIFO fallback — one bundle entry per startSession().
  const next = envBundleCursor!.queue.shift();
  if (next) return [...next.turns];

  // Exhausted the bundle's FIFO queue — re-read in case the harness swapped
  // in new content after the worker first saw this file.
  await reloadEnvBundle(file);
  const matchAfter = envBundleCursor!.byPrompt.find((r) => systemPrompt.includes(r.match));
  if (matchAfter) return [...matchAfter.session.turns];
  const fresh = envBundleCursor!.queue.shift();
  if (!fresh) {
    throw new Error(`CONDUIT_STUB_SCRIPT exhausted — no more sessions at ${file}`);
  }
  return [...fresh.turns];
}

async function reloadEnvBundle(file: string): Promise<void> {
  const raw = await fs.readFile(file, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  envBundleCursor = {
    file,
    queue: flattenToSessions(parsed),
    byPrompt: extractByPromptRules(parsed),
  };
}

function flattenToSessions(parsed: unknown): StubSessionScript[] {
  if (parsed && typeof parsed === 'object') {
    const bundle = parsed as StubSessionBundle;
    if (Array.isArray(bundle.sessions)) return [...bundle.sessions];
    if (Array.isArray(bundle.byPrompt)) return []; // byPrompt-only bundles don't feed FIFO
    const session = parsed as StubSessionScript;
    if (Array.isArray(session.turns)) return [session];
  }
  // Bare StubScript — one-turn session.
  return [{ turns: [parsed as StubScript] }];
}

function extractByPromptRules(
  parsed: unknown,
): Array<{ match: string; session: StubSessionScript }> {
  if (parsed && typeof parsed === 'object') {
    const bundle = parsed as StubSessionBundle;
    if (Array.isArray(bundle.byPrompt)) return [...bundle.byPrompt];
  }
  return [];
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
