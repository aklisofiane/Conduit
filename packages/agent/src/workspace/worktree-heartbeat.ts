import fs from 'node:fs/promises';
import path from 'node:path';
import { CONDUIT_DIR } from './conduit-folder';

/**
 * Liveness heartbeat for ticket-branch worktrees.
 *
 * A run that owns a worktree writes `<worktree>/.conduit/.heartbeat` and
 * refreshes its mtime on a timer while any activity operates on that
 * worktree. Eviction (`worktree-cleanup.ts`) reads the file: a *fresh*
 * heartbeat on a branch-match means a live owner — don't steal its worktree.
 *
 * `.conduit/` is gitignored, so the heartbeat never shows up in the agent's
 * `git status`. Liveness lives on the filesystem (self-expiring mtime)
 * rather than `WorkflowRun.status`, which can get stuck at `RUNNING` and
 * would otherwise block the branch forever.
 */

/** Cadence the writers refresh the heartbeat at — matches the existing 30s
 *  Temporal in-activity heartbeat timer in `run-agent-node.ts`. */
export const WORKTREE_HEARTBEAT_INTERVAL_MS = 30_000;

/** A heartbeat older than this is treated as a dead owner — at 4× the touch
 *  cadence it tolerates a couple of missed refreshes before declaring a run
 *  crashed. */
export const WORKTREE_STALE_MS = 120_000;

function heartbeatPath(worktreePath: string): string {
  return path.join(worktreePath, CONDUIT_DIR, '.heartbeat');
}

/**
 * Create or refresh the mtime of `<worktreePath>/.conduit/.heartbeat`,
 * ensuring `.conduit/` exists first. Best-effort — never throws; a failed
 * touch just means the next eviction may treat this worktree as stale, which
 * is the safe-but-conservative direction.
 */
export async function touchWorktreeHeartbeat(worktreePath: string): Promise<void> {
  const file = heartbeatPath(worktreePath);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const now = new Date();
    // Open-with-`a` then `utimes` so an existing file's mtime is bumped and a
    // missing one is created — both land on a fresh mtime.
    const handle = await fs.open(file, 'a');
    try {
      await handle.utimes(now, now);
    } finally {
      await handle.close();
    }
  } catch {
    // Best-effort: a worktree we can't write to will simply read as stale.
  }
}

/**
 * True iff the heartbeat file exists and was touched within `staleMs`. A
 * missing file (never written, or already cleaned up) reads as not-alive, so
 * a crashed run's leftover worktree is safe to evict.
 */
export async function isWorktreeAlive(
  worktreePath: string,
  staleMs: number = WORKTREE_STALE_MS,
): Promise<boolean> {
  try {
    const stat = await fs.stat(heartbeatPath(worktreePath));
    return Date.now() - stat.mtimeMs < staleMs;
  } catch {
    return false;
  }
}
