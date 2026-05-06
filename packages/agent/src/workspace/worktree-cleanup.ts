import fs from 'node:fs/promises';
import path from 'node:path';
import { git } from './git';
import { runsRoot } from './paths';

/**
 * Force-removes worktrees registered against the repo at `repoPath` whose
 * path or branch conflicts with `target`/`branchName`, then `fs.rm`'s the
 * `target` dir itself in case it was stranded without a registration —
 * `worktree add` rejects a non-empty target even with `--force`. `fs.rm`
 * paths are gated on `runsRoot()` so a misparse can't blast unrelated dirs.
 *
 * `repoPath` may be the bare clone or any linked worktree — git resolves
 * the common dir either way.
 */
export async function dropConflictingWorktrees(
  repoPath: string,
  target: string,
  branchName?: string,
): Promise<void> {
  const list = await git(['worktree', 'list', '--porcelain'], { cwd: repoPath }).catch(
    () => '',
  );
  const conflicting = parseWorktreePorcelain(list).filter(
    (w) => w.path === target || (branchName !== undefined && w.branch === branchName),
  );
  const runsPrefix = `${runsRoot()}${path.sep}`;
  for (const w of conflicting) {
    await git(['worktree', 'remove', '--force', w.path], { cwd: repoPath }).catch(
      () => undefined,
    );
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
