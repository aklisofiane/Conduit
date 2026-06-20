import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@conduit/shared';
import type { RunnerEvent } from '@conduit/shared/runner';
import { runAgentTurns, type TurnSession } from './turns';

function text(delta: string): AgentEvent {
  return { type: 'text', delta } as AgentEvent;
}

async function* yields(...events: AgentEvent[]): AsyncIterable<AgentEvent> {
  for (const e of events) yield e;
}

// eslint-disable-next-line require-yield
async function* throws(message: string): AsyncIterable<AgentEvent> {
  throw new Error(message);
}

describe('runAgentTurns', () => {
  it('completes the node when the summary turn fails', async () => {
    const seen: RunnerEvent[] = [];
    const session: TurnSession = {
      run: (msg) =>
        msg === 'SUMMARY'
          ? throws('Reconnecting... 2/5 (timeout waiting for child process to exit)')
          : yields(text('did the work')),
    };

    await expect(
      runAgentTurns({
        session,
        prompts: { main: 'MAIN', summary: 'SUMMARY' },
        emit: (e) => seen.push(e),
        abort: new AbortController(),
      }),
    ).resolves.toBeUndefined();

    // Main-turn work was forwarded; the summary failure is downgraded to a
    // non-fatal system log instead of throwing the node away.
    expect(seen.some((e) => e.kind === 'agent')).toBe(true);
    const sys = seen.find((e) => e.kind === 'system');
    expect(sys?.kind === 'system' && sys.message).toContain('summary turn did not finish');
  });

  it('runs the optional issue-writeback turn before the summary', async () => {
    const order: string[] = [];
    const session: TurnSession = {
      run: (msg) => {
        order.push(msg);
        return yields();
      },
    };

    await runAgentTurns({
      session,
      prompts: { main: 'MAIN', issueWriteback: 'WRITEBACK', summary: 'SUMMARY' },
      emit: () => {},
      abort: new AbortController(),
    });

    expect(order).toEqual(['MAIN', 'WRITEBACK', 'SUMMARY']);
  });

  it('propagates a main-turn failure (genuine node failure)', async () => {
    const session: TurnSession = {
      run: (msg) => (msg === 'MAIN' ? throws('main boom') : yields()),
    };

    await expect(
      runAgentTurns({
        session,
        prompts: { main: 'MAIN', summary: 'SUMMARY' },
        emit: () => {},
        abort: new AbortController(),
      }),
    ).rejects.toThrow('main boom');
  });
});
