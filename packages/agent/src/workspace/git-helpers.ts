import fs from 'node:fs/promises';
import path from 'node:path';
import { BranchBusyError, WorkspaceError } from '../errors/index';
import { git, GitError } from './git';
import { dropConflictingWorktrees } from './worktree-cleanup';
import type { ConnectionContext } from './types';

function withTokenUrl(connection: ConnectionContext): string {
  if (!connection.token) return connection.cloneUrl;
  try {
    const u = new URL(connection.cloneUrl);
    u.username = 'x-access-token';
    u.password = connection.token;
    return u.toString();
  } catch {
    return connection.cloneUrl;
  }
}

export async function ensureBaseClone(bare: string, connection: ConnectionContext): Promise<void> {
  const head = path.join(bare, 'HEAD');
  try {
    await fs.access(head);
    return;
  } catch {
    // fall through to clone
  }
  await fs.mkdir(path.dirname(bare), { recursive: true });
  const url = withTokenUrl(connection);
  await git(['clone', '--bare', url, bare]);
  await git(['remote', 'set-url', 'origin', connection.cloneUrl], { cwd: bare }).catch(() => undefined);
}

export async function fetchWithAuth(bare: string, connection: ConnectionContext): Promise<void> {
  // Fetch remote heads into `refs/remotes/origin/*` rather than mirroring
  // into `refs/heads/*`. The base clone is shared across every run/workflow
  // for this repo and hosts all of their worktrees; if any worktree has a
  // branch checked out, git refuses to update that same ref under
  // `refs/heads/*` and the whole fetch aborts. `refs/remotes/origin/*` is
  // never checked out, so the fetch always advances.
  //
  // The base clone's stored remote URL is cleaned, so we inject a tokenized
  // URL at fetch time. Falls back to `origin` (the clean URL) for public
  // repos with no token.
  const remote = connection.token ? withTokenUrl(connection) : 'origin';
  await git(['fetch', '--prune', remote, '+refs/heads/*:refs/remotes/origin/*'], { cwd: bare });
}

export async function remoteBranchExists(bare: string, branchName: string): Promise<boolean> {
  // We fetch remote heads into `refs/remotes/origin/*`, so an existing ref
  // there means the branch is on the remote (we just fetched). Checking
  // `refs/remotes/origin/*` — not `refs/heads/*` — also avoids being fooled
  // by a stale local branch a prior worktree-add left behind. Use `show-ref`
  // instead of `ls-remote` to stay offline and avoid re-hitting auth.
  try {
    const out = await git(['show-ref', '--verify', `refs/remotes/origin/${branchName}`], {
      cwd: bare,
    });
    return out.trim().length > 0;
  } catch (err) {
    if (err instanceof GitError) return false;
    throw err;
  }
}

export async function defaultBranch(bare: string): Promise<string> {
  const out = await git(['symbolic-ref', '--short', 'HEAD'], { cwd: bare }).catch(() => '');
  return out.trim() || 'main';
}

export async function stripRemoteAuth(worktreePath: string, cleanUrl: string): Promise<void> {
  await git(['remote', 'set-url', 'origin', cleanUrl], { cwd: worktreePath }).catch(
    () => undefined,
  );
}

export async function addTrackingWorktree(
  bare: string,
  target: string,
  branchName: string,
): Promise<void> {
  // `-B <branch> refs/remotes/origin/<branch>` resets the local branch to the
  // just-fetched remote tip before checking it out, so iteration N+1 lands on
  // iteration N's pushed commits. (A plain `worktree add <branch>` would reuse
  // a stale local ref left by a prior add and miss them.)
  const startPoint = `refs/remotes/origin/${branchName}`;
  try {
    await git(['worktree', 'add', '--force', '-B', branchName, target, startPoint], { cwd: bare });
    return;
  } catch (err) {
    if (!(err instanceof GitError)) throw err;
    // `-B` refuses to reset a branch that's still checked out in another
    // worktree — typically a stale leftover from a crashed/retried run. Drop
    // the conflicting worktree (by path or branch) and retry once.
    try {
      await dropConflictingWorktrees(bare, target, branchName);
      await git(['worktree', 'add', '--force', '-B', branchName, target, startPoint], {
        cwd: bare,
      });
    } catch (recoveryErr) {
      // A live owner holds the branch — propagate so the activity wait loop
      // can retry; do not swallow it into a generic WorkspaceError.
      if (recoveryErr instanceof BranchBusyError) throw recoveryErr;
      const recoveryStderr =
        recoveryErr instanceof GitError ? recoveryErr.stderr.trim() : String(recoveryErr);
      throw new WorkspaceError(
        `git worktree add ${branchName} into ${target} failed: ${err.stderr.trim()}; recovery: ${recoveryStderr}`,
      );
    }
  }
}

export async function createTrackingWorktree(
  bare: string,
  target: string,
  branchName: string,
  baseRef: string,
): Promise<void> {
  // Base off the remote-tracking ref, not the local head — `fetchWithAuth`
  // now only advances `refs/remotes/origin/*`, so the local `refs/heads/<baseRef>`
  // (e.g. `main`) is frozen at clone time and would branch off a stale tip.
  const startPoint = `refs/remotes/origin/${baseRef}`;
  try {
    await git(['worktree', 'add', '-b', branchName, target, startPoint], { cwd: bare });
    return;
  } catch (err) {
    if (!(err instanceof GitError)) throw err;
    // Retry uses `--force -B` because the failed `add -b` creates the branch
    // ref at `<baseRef>` before bailing; a stale loose ref from a crashed
    // run can be in the same shape. Reset is safe — the caller confirmed
    // the branch doesn't exist on the remote, so a local-only ref is data
    // we can't recover regardless.
    try {
      await dropConflictingWorktrees(bare, target, branchName);
      await git(['worktree', 'add', '--force', '-B', branchName, target, startPoint], {
        cwd: bare,
      });
    } catch (recoveryErr) {
      // A live owner holds the branch — propagate so the activity wait loop
      // can retry; do not swallow it into a generic WorkspaceError.
      if (recoveryErr instanceof BranchBusyError) throw recoveryErr;
      const recoveryStderr =
        recoveryErr instanceof GitError ? recoveryErr.stderr.trim() : String(recoveryErr);
      throw new WorkspaceError(
        `git worktree add -b ${branchName} from ${baseRef} failed: ${err.stderr.trim()}; recovery: ${recoveryStderr}`,
      );
    }
  }
}
