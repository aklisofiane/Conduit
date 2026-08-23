import fs from 'node:fs/promises';
import path from 'node:path';
import { BranchBusyError } from '../errors/index';
import { git } from './git';
import { runsRoot } from './paths';
import { isWorktreeAlive } from './worktree-heartbeat';

/**
 * Force-removes worktrees registered against the repo at `repoPath` whose
 * path or branch conflicts with `target`/`branchName`, then `fs.rm`'s the
 * `target` dir itself in case it was stranded without a registration —
 * `worktree add` rejects a non-empty target even with `--force`. `fs.rm`
 * paths are gated on `runsRoot()` so a misparse can't blast unrelated dirs.
 *
 * Two conflict shapes are handled differently:
 *
 *   - **Path match** (`w.path === target`) — a stale leftover at *this run's
 *     own* target (a crashed/retried same run). Always safe to remove.
 *   - **Branch match** (`w.branch === branchName`, different path) — *another*
 *     worktree holds the branch. If its `.conduit/.heartbeat` is fresh, a
 *     live run owns it and we must not steal its working directory: throw
 *     `BranchBusyError` (the activity wait loop retries). Only a stale/absent
 *     heartbeat (crashed owner) is force-removed.
 *
 * `repoPath` may be the bare clone or any linked worktree — git resolves
 * the common dir either way.
 */
export async function dropConflictingWorktrees(
  repoPath: string,
  target: string,
  branchName?: string,
): Promise<void> {
  const list = await git(['worktree', 'list', '--porcelain'], { cwd: repoPath }).catch(() => '');
  const worktrees = parseWorktreePorcelain(list);
  const pathMatches = worktrees.filter((w) => w.path === target);
  const branchMatches =
    branchName === undefined
      ? []
      : worktrees.filter((w) => w.path !== target && w.branch === branchName);

  // A live branch-match is another run's in-flight worktree — evicting it
  // would destroy a running agent's cwd. Fail fast before removing anything;
  // the activity-level wait loop retries until the owner finishes or dies.
  for (const w of branchMatches) {
    if (await isWorktreeAlive(w.path)) {
      throw new BranchBusyError(branchName!, w.path);
    }
  }

  const runsPrefix = `${runsRoot()}${path.sep}`;
  // Path-matches (own stale target) + dead branch-matches: safe to remove.
  for (const w of [...pathMatches, ...branchMatches]) {
    await git(['worktree', 'remove', '--force', w.path], { cwd: repoPath }).catch(() => undefined);
    if (w.path.startsWith(runsPrefix)) {
      await fs.rm(w.path, { recursive: true, force: true });
    }
  }
  if (target.startsWith(runsPrefix)) {
    await fs.rm(target, { recursive: true, force: true });
  }
  await git(['worktree', 'prune'], { cwd: repoPath }).catch(() => undefined);
}

/**
 * Parse `git worktree list --porcelain` into `{ path, branch }` records.
 * `branch` is the short name (`refs/heads/` prefix stripped). The leading
 * bare-clone block has no `branch` line, so callers filtering on `branch`
 * drop it implicitly.
 */
function parseWorktreePorcelain(output: string): Array<{ path: string; branch?: string }> {
  const result: Array<{ path: string; branch?: string }> = [];
  let current: { path?: string; branch?: string } = {};
  for (const line of output.split('\n')) {
    if (line === '') {
      if (current.path) result.push({ path: current.path, branch: current.branch });
      current = {};
      continue;
    }
    if (line.startsWith('worktree ')) current.path = line.slice('worktree '.length);
    else if (line.startsWith('branch refs/heads/'))
      current.branch = line.slice('branch refs/heads/'.length);
  }
  if (current.path) result.push({ path: current.path, branch: current.branch });
  return result;
}
