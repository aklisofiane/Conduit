/**
 * In-process path-keyed async mutex.
 *
 * Serializes base-clone operations that would otherwise race on
 * `git worktree add` — two activities resolving `ticket-branch` workspaces
 * against the same base clone concurrently, or one running while a retry
 * kicks in. Scoped to one worker process; multi-worker-on-same-host
 * contention requires a real filesystem lockfile — deferred (see
 * docs/design-docs/branch-management.md "Concurrency").
 */
const chains = new Map<string, Promise<unknown>>();

export async function withPathLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Chain our release after the previous holder so later waiters queue up.
  const gated = prev.then(() => next);
  chains.set(key, gated);

  try {
    await prev;
    return await fn();
  } finally {
    release();
    // Drop the entry if no one else queued behind us (identity check — the
    // map may have been advanced by a subsequent `withPathLock` call).
    if (chains.get(key) === gated) chains.delete(key);
  }
}
