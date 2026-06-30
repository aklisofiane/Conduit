import type { AgentEvent, AgentRequest } from '@conduit/shared';
import { ConstraintExceededError } from '../errors/index';

interface ProviderCounters {
  turns: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ConstraintState {
  counters: ProviderCounters;
  startedAt: number;
  cumulativeUsage?: boolean;
}

export function createConstraintState(opts: { cumulativeUsage?: boolean } = {}): ConstraintState {
  return {
    counters: { turns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0 },
    startedAt: Date.now(),
    cumulativeUsage: opts.cumulativeUsage ?? false,
  };
}

/**
 * Wrap a provider's raw `AgentEvent` stream with constraint enforcement so the
 * adapters stay dumb — they only translate SDK events; counting turns/tools/
 * tokens and tripping the limits lives here, in one place. Stops the stream
 * after the terminating `done` event.
 */
export async function* enforceConstraints(
  source: AsyncIterable<AgentEvent>,
  req: AgentRequest,
  state: ConstraintState,
): AsyncIterable<AgentEvent> {
  const { counters, startedAt } = state;
  const cumulativeUsage = state.cumulativeUsage ?? false;
  for await (const event of source) {
    // `text` / `tool_result` events (the bulk of a stream) never move a
    // counter, so only re-check the count limits when one actually changed.
    if (applyCounters(event, counters, cumulativeUsage)) checkCountLimits(req, counters);
    checkTimeout(req, startedAt);
    yield event;
    if (event.type === 'done') return;
  }
}

/** Mutate counters for the event; returns true when a counter changed. */
function applyCounters(
  event: AgentEvent,
  counters: ProviderCounters,
  cumulativeUsage: boolean,
): boolean {
  if (event.type === 'tool_call') {
    counters.toolCalls += 1;
    return true;
  }
  if (event.type === 'usage') {
    // Count *all* input the model processed (full-rate + cache) so the
    // maxTokens backstop reflects true consumption, not just the uncached slice.
    const inputTokens =
      event.inputTokens + (event.cachedInputTokens ?? 0) + (event.cacheCreationInputTokens ?? 0);
    if (cumulativeUsage) {
      counters.inputTokens = inputTokens;
      counters.outputTokens = event.outputTokens;
    } else {
      counters.inputTokens += inputTokens;
      counters.outputTokens += event.outputTokens;
    }
    counters.turns += 1;
    return true;
  }
  return false;
}

function checkCountLimits(req: AgentRequest, counters: ProviderCounters): void {
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
}

function checkTimeout(req: AgentRequest, startedAt: number): void {
  const { timeoutSec } = req.constraints;
  if (!timeoutSec) return;
  const elapsed = (Date.now() - startedAt) / 1000;
  if (elapsed > timeoutSec) {
    throw new ConstraintExceededError('timeoutSec', timeoutSec, Math.floor(elapsed));
  }
}
