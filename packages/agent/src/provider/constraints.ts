import type { AgentEvent, AgentRequest } from '@conduit/shared';
import { ConstraintExceededError } from '../errors/index';

export interface ProviderCounters {
  turns: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
}

export function newCounters(): ProviderCounters {
  return { turns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0 };
}

export function applyCounters(event: AgentEvent, counters: ProviderCounters): void {
  if (event.type === 'tool_call') counters.toolCalls += 1;
  if (event.type === 'usage') {
    counters.inputTokens += event.inputTokens;
    counters.outputTokens += event.outputTokens;
    counters.turns += 1;
  }
}

export function checkConstraints(
  req: AgentRequest,
  counters: ProviderCounters,
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
