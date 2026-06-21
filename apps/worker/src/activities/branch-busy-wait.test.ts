import { describe, expect, it, vi } from 'vitest';
import { BranchBusyError } from '@conduit/agent';
import {
  BRANCH_BUSY_DEADLINE_MS,
  BRANCH_BUSY_POLL_MS,
  abortableDelay,
  resolveWithGraceWindow,
} from './branch-busy-wait';

/** Fake clock that advances by `pollMs` on every (no-op) sleep, so the loop
 *  makes deterministic progress toward the deadline without real timers. */
function fakeDeps(pollMs = BRANCH_BUSY_POLL_MS) {
  let clock = 0;
  const heartbeats: Array<{ branchName: string; ownerPath: string; elapsedMs: number }> = [];
  return {
    heartbeats,
    deps: {
      now: () => clock,
      sleep: vi.fn(async () => {
        clock += pollMs;
      }),
      heartbeat: (info: { branchName: string; ownerPath: string; elapsedMs: number }) =>
        heartbeats.push(info),
    },
  };
}

describe('resolveWithGraceWindow', () => {
  it('resolves once a collision clears within the window', async () => {
    const { deps, heartbeats } = fakeDeps();
    let calls = 0;
    const resolve = vi.fn(async () => {
      calls += 1;
      if (calls <= 2) throw new BranchBusyError('conduit/1-x', '/owner');
      return 'workspace';
    });

    const result = await resolveWithGraceWindow(resolve, deps);

    expect(result).toBe('workspace');
    expect(resolve).toHaveBeenCalledTimes(3);
    // One heartbeat emitted before each of the two retries.
    expect(heartbeats).toHaveLength(2);
    expect(deps.sleep).toHaveBeenCalledTimes(2);
    expect(deps.sleep).toHaveBeenCalledWith(BRANCH_BUSY_POLL_MS);
  });

  it('fails fast with BranchBusyError after the deadline, emitting heartbeats throughout', async () => {
    const { deps, heartbeats } = fakeDeps();
    const resolve = vi.fn(async () => {
      throw new BranchBusyError('conduit/1-x', '/owner');
    });

    await expect(resolveWithGraceWindow(resolve, deps)).rejects.toBeInstanceOf(BranchBusyError);

    // 300s / 30s = 10 heartbeats before the deadline check trips.
    const expected = BRANCH_BUSY_DEADLINE_MS / BRANCH_BUSY_POLL_MS;
    expect(heartbeats).toHaveLength(expected);
    expect(heartbeats[0]?.elapsedMs).toBe(0);
    expect(heartbeats.at(-1)?.elapsedMs).toBe(BRANCH_BUSY_DEADLINE_MS - BRANCH_BUSY_POLL_MS);
  });

  it('propagates a non-BranchBusy error immediately without retrying', async () => {
    const { deps, heartbeats } = fakeDeps();
    const resolve = vi.fn(async () => {
      throw new Error('boom');
    });

    await expect(resolveWithGraceWindow(resolve, deps)).rejects.toThrow('boom');
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(heartbeats).toHaveLength(0);
    expect(deps.sleep).not.toHaveBeenCalled();
  });
});

describe('abortableDelay', () => {
  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(abortableDelay(10_000, controller.signal)).rejects.toThrow('cancelled');
  });

  it('rejects as soon as the signal aborts mid-wait', async () => {
    const controller = new AbortController();
    const p = abortableDelay(10_000, controller.signal);
    controller.abort();
    await expect(p).rejects.toThrow('cancelled');
  });

  it('resolves after the delay when never aborted', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const p = abortableDelay(50, controller.signal);
      vi.advanceTimersByTime(50);
      await expect(p).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
