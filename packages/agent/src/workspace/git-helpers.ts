import fs from 'node:fs/promises';
import path from 'node:path';
import { errorMessage } from '@conduit/shared/runtime';
import { BranchBusyError, WorkspaceError } from '../errors/index';
import { git, GitError } from './git';
import { dropConflictingWorktrees } from './worktree-cleanup';
import type { ConnectionContext } from './types';

/**
 * Inline git credential helper for worker-side clone/fetch. The token rides
 * the child process env (`CONDUIT_GIT_TOKEN`) and is expanded by the shell
 * git spawns for `!`-helpers, so the argv carries only this fixed string —
 * a tokenized URL or an inline password would show up in `ps` output for
 * every same-user process. The agent-facing push path solves the same
 * problem with an on-disk script (see push-auth.ts) because the *agent's*
 * git needs it; here the token never needs to touch disk.
 */
const INLINE_CREDENTIAL_HELPER =
  '!f() { echo username=x-access-token; echo "password=$CONDUIT_GIT_TOKEN"; }; f';

/**
 * `-c` flags + child env for an authenticated clone/fetch. Exported for
 * unit tests (asserting the token stays out of argv). The leading empty
 * `credential.helper=` clears system/global helpers so ours is the only one
 * consulted; `GIT_TERMINAL_PROMPT=0` makes a rejected token fail fast
 * instead of waiting on a prompt that can never be answered.
 */
export function cloneFetchAuthArgs(connection: ConnectionContext): {
  flags: string[];
  env?: NodeJS.ProcessEnv;
} {
  if (!connection.token) return { flags: [] };
  return {
    flags: ['-c', 'credential.helper=', '-c', `credential.helper=${INLINE_CREDENTIAL_HELPER}`],
    env: {
      ...process.env,
      CONDUIT_GIT_TOKEN: connection.token,
      GIT_TERMINAL_PROMPT: '0',
    },
  };
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
  // Clone the clean URL — auth comes from the credential helper, so the
  // stored remote URL never carries the token.
  const { flags, env } = cloneFetchAuthArgs(connection);
  await git([...flags, 'clone', '--bare', connection.cloneUrl, bare], { env });
}

export async function fetchWithAuth(bare: string, connection: ConnectionContext): Promise<void> {
  // Fetch remote heads into `refs/remotes/origin/*` rather than mirroring
  // into `refs/heads/*`. The base clone is shared across every run/workflow
  // for this repo and hosts all of their worktrees; if any worktree has a
  // branch checked out, git refuses to update that same ref under
  // `refs/heads/*` and the whole fetch aborts. `refs/remotes/origin/*` is
  // never checked out, so the fetch always advances.
  //
  // `origin` is the clean URL; the credential helper supplies the token for
  // private repos without it ever appearing in argv or git config.
  const { flags, env } = cloneFetchAuthArgs(connection);
  await git([...flags, 'fetch', '--prune', 'origin', '+refs/heads/*:refs/remotes/origin/*'], {
    cwd: bare,
    env,
  });
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
  await addWorktree(bare, target, branchName, `refs/remotes/origin/${branchName}`, {
    create: false,
    describe: `git worktree add ${branchName} into ${target}`,
  });
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
  await addWorktree(bare, target, branchName, `refs/remotes/origin/${baseRef}`, {
    create: true,
    describe: `git worktree add -b ${branchName} from ${baseRef}`,
  });
}

/**
 * Add a worktree for `branchName` at `target`, with a single shared recovery
 * path. The first attempt differs only by whether the branch is being created
 * (`-b`, off a base ref) or reset to a just-fetched remote tip (`--force -B`).
 *
 * On a `GitError` — typically a stale ref/registration left by a crashed or
 * retried run — drop the conflicting worktree (by path or branch) and retry
 * once with `--force -B`. (The `-b` create path's failure also leaves the
 * branch ref at its base, so resetting it is the right recovery; the caller
 * confirmed the branch isn't on the remote, so a local-only ref is data we
 * can't recover regardless.) A `BranchBusyError` means a live owner holds the
 * branch — propagate it so the activity wait loop can retry rather than
 * swallowing it into a generic `WorkspaceError`.
 */
async function addWorktree(
  bare: string,
  target: string,
  branchName: string,
  startPoint: string,
  opts: { create: boolean; describe: string },
): Promise<void> {
  const firstAttempt = opts.create
    ? ['worktree', 'add', '-b', branchName, target, startPoint]
    : ['worktree', 'add', '--force', '-B', branchName, target, startPoint];
  try {
    await git(firstAttempt, { cwd: bare });
    return;
  } catch (err) {
    if (!(err instanceof GitError)) throw err;
    try {
      await dropConflictingWorktrees(bare, target, branchName);
      await git(['worktree', 'add', '--force', '-B', branchName, target, startPoint], {
        cwd: bare,
      });
    } catch (recoveryErr) {
      if (recoveryErr instanceof BranchBusyError) throw recoveryErr;
      const recoveryStderr =
        recoveryErr instanceof GitError ? recoveryErr.stderr.trim() : errorMessage(recoveryErr);
      throw new WorkspaceError(
        `${opts.describe} failed: ${err.stderr.trim()}; recovery: ${recoveryStderr}`,
      );
    }
  }
}
