import { describe, expect, it } from 'vitest';
import type { AgentEvent, AgentRequest } from '@conduit/shared';
import { ConstraintExceededError } from '../errors/index';
import {
  type ConstraintState,
  createConstraintState,
  enforceConstraints,
} from './constraints';

function baseRequest(overrides: Partial<AgentRequest> = {}): AgentRequest {
  return {
    model: 'stub-model',
    systemPrompt: '',
    mcpServers: [],
    workspacePath: '/tmp/unused',
    webSearch: false,
    constraints: {},
    ...overrides,
  };
}

async function* fakeSource(events: AgentEvent[]): AsyncIterable<AgentEvent> {
  for (const e of events) yield e;
}

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

describe('enforceConstraints with shared ConstraintState', () => {
  it('accumulates tool calls across invocations', async () => {
    const state = createConstraintState();
    const req = baseRequest({ constraints: { maxToolCalls: 1 } });

    const first = await collect(
      enforceConstraints(
        fakeSource([
          { type: 'tool_call', id: 't1', name: 'Bash', input: {} },
          { type: 'done' },
        ]),
        req,
        state,
      ),
    );
    expect(first.map((e) => e.type)).toEqual(['tool_call', 'done']);

    await expect(
      collect(
        enforceConstraints(
          fakeSource([
            { type: 'tool_call', id: 't2', name: 'Bash', input: {} },
            { type: 'done' },
          ]),
          req,
          state,
        ),
      ),
    ).rejects.toBeInstanceOf(ConstraintExceededError);
  });

  it('accumulates tokens across invocations', async () => {
    const state = createConstraintState();
    const req = baseRequest({ constraints: { maxTokens: 150 } });

    await collect(
      enforceConstraints(
        fakeSource([
          { type: 'usage', inputTokens: 50, outputTokens: 40 },
          { type: 'done' },
        ]),
        req,
        state,
      ),
    );

    await expect(
      collect(
        enforceConstraints(
          fakeSource([
            { type: 'usage', inputTokens: 50, outputTokens: 40 },
            { type: 'done' },
          ]),
          req,
          state,
        ),
      ),
    ).rejects.toBeInstanceOf(ConstraintExceededError);
  });

  it('accumulates turns across invocations', async () => {
    const state = createConstraintState();
    const req = baseRequest({ constraints: { maxTurns: 1 } });

    await collect(
      enforceConstraints(
        fakeSource([
          { type: 'usage', inputTokens: 1, outputTokens: 1 },
          { type: 'done' },
        ]),
        req,
        state,
      ),
    );

    await expect(
      collect(
        enforceConstraints(
          fakeSource([
            { type: 'usage', inputTokens: 1, outputTokens: 1 },
            { type: 'done' },
          ]),
          req,
          state,
        ),
      ),
    ).rejects.toBeInstanceOf(ConstraintExceededError);
  });

  it('measures timeout from session start, not per invocation', async () => {
    const state: ConstraintState = {
      counters: { turns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0 },
      startedAt: Date.now() - 5_000,
    };
    const req = baseRequest({ constraints: { timeoutSec: 3 } });

    await expect(
      collect(
        enforceConstraints(
          fakeSource([{ type: 'text', delta: 'hello' }, { type: 'done' }]),
          req,
          state,
        ),
      ),
    ).rejects.toBeInstanceOf(ConstraintExceededError);
  });

  it('works correctly within a single invocation', async () => {
    const state = createConstraintState();
    const req = baseRequest({ constraints: { maxToolCalls: 1 } });

    await expect(
      collect(
        enforceConstraints(
          fakeSource([
            { type: 'tool_call', id: 't1', name: 'Bash', input: {} },
            { type: 'tool_call', id: 't2', name: 'Bash', input: {} },
            { type: 'done' },
          ]),
          req,
          state,
        ),
      ),
    ).rejects.toBeInstanceOf(ConstraintExceededError);
  });
});
