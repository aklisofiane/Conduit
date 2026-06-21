import { BranchBusyError } from '@conduit/agent';

/**
 * Grace window for ticket-branch collisions.
 *
 * Workspace resolution fails fast with `BranchBusyError` when another *live*
 * run holds the branch (see worktree-cleanup.ts). The wait lives here in the
 * activity — not in the resolver — because resolution runs before Temporal's
 * heartbeater starts, and a long internal wait would trip the 120s
 * `heartbeatTimeout`. Each retry re-takes and releases the base-clone lock,
 * so the wait never holds the mutex.
 *
 * Poll loop: on `BranchBusyError`, emit a Temporal heartbeat, sleep, retry —
 * up to the deadline. If the owner finishes/dies within the window the retry
 * resolves cleanly; at the deadline we rethrow so the node lands `FAILED`
 * instead of hanging.
 */

/** Total time to wait for a live owner to release the branch (5 min). */
export const BRANCH_BUSY_DEADLINE_MS = 300_000;
/** Gap between resolve attempts while the branch is busy. */
export const BRANCH_BUSY_POLL_MS = 30_000;

export interface GraceWindowDeps {
  /** Sleep `ms`, rejecting promptly if the activity is cancelled. */
  sleep: (ms: number) => Promise<void>;
  /** Monotonic-ish clock; injectable for tests. */
  now: () => number;
  /** Emit a Temporal heartbeat so the long wait doesn't trip liveness. */
  heartbeat: (info: { branchName: string; ownerPath: string; elapsedMs: number }) => void;
}

/**
 * Run `resolve`, retrying while it throws `BranchBusyError` until the deadline.
 * Any other error propagates immediately. Returns the resolved value or
 * rethrows the last `BranchBusyError` once the window is exhausted.
 */
export async function resolveWithGraceWindow<T>(
  resolve: () => Promise<T>,
  deps: GraceWindowDeps,
  deadlineMs: number = BRANCH_BUSY_DEADLINE_MS,
  pollMs: number = BRANCH_BUSY_POLL_MS,
): Promise<T> {
  const start = deps.now();
  for (;;) {
    try {
      return await resolve();
    } catch (err) {
      if (!(err instanceof BranchBusyError)) throw err;
      const elapsed = deps.now() - start;
      if (elapsed >= deadlineMs) throw err;
      deps.heartbeat({ branchName: err.branchName, ownerPath: err.ownerPath, elapsedMs: elapsed });
      await deps.sleep(pollMs);
    }
  }
}

/**
 * `setTimeout`-backed sleep that rejects as soon as `signal` aborts, so a
 * cancelled run doesn't sit out the full poll interval.
 */
export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('cancelled'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new Error('cancelled'));
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
