import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkspaceError } from '../errors/index';
import { git, GitError } from './git';
import { withPathLock } from './lock';
import { baseClonePath, nodeWorkspacePath } from './paths';
import { dropConflictingWorktrees } from './worktree-cleanup';
import type { ConnectionContext, ResolvedWorkspace } from './types';

export interface FixedBranchResolveInput {
  runId: string;
  nodeName: string;
  connection: ConnectionContext;
  /** User-selected branch the cron trigger fires against. */
  branch: string;
}

/**
 * Resolve a `fixed-branch` workspace — used by cron triggers, where the
 * agent works directly on a user-selected branch instead of a per-ticket
 * `conduit/<id>-<slug>` ref.
 *
 * Mirrors `resolveTicketBranchWorkspace` (lock, base clone, fetch, worktree
 * add) but with no row upsert, no slug derivation, and no PR fallback.
 * The branch must already exist on the remote — cron has no notion of
 * "creating" the branch.
 *
 * Idempotent under Temporal retries: the lock + `dropConflictingWorktrees`
 * pre-pass mean a re-entry produces the same checkout without leaking
 * worktree registrations.
 */
export async function resolveFixedBranchWorkspace(
  input: FixedBranchResolveInput,
): Promise<ResolvedWorkspace> {
  const { runId, nodeName, connection, branch } = input;
  const bare = baseClonePath(connection.platform, connection.host, connection.owner, connection.repo);
  const target = nodeWorkspacePath(runId, nodeName);

  return withPathLock(bare, async () => {
    await ensureBaseClone(bare, connection);
    await dropConflictingWorktrees(bare, target);
    await Promise.all([
      fetchWithAuth(bare, connection),
      fs.mkdir(path.dirname(target), { recursive: true }),
    ]);

    if (!(await remoteBranchExists(bare, branch))) {
      throw new WorkspaceError(
        `fixed-branch workspace on node "${nodeName}" references branch "${branch}" which does not exist on ${connection.owner}/${connection.repo}.`,
      );
    }

    // `-B <branch> refs/remotes/origin/<branch>` resets the local branch to the
    // just-fetched remote tip so the cron run works against the latest commits.
    const startPoint = `refs/remotes/origin/${branch}`;
    try {
      await git(['worktree', 'add', '--force', '-B', branch, target, startPoint], { cwd: bare });
    } catch (err) {
      if (!(err instanceof GitError)) throw err;
      // `-B` refuses to reset a branch still checked out in another worktree —
      // typically a stale leftover from a crashed/retried run. Drop the
      // conflicting worktree (by path or branch) and retry once.
      try {
        await dropConflictingWorktrees(bare, target, branch);
        await git(['worktree', 'add', '--force', '-B', branch, target, startPoint], { cwd: bare });
      } catch (recoveryErr) {
        const recoveryStderr =
          recoveryErr instanceof GitError ? recoveryErr.stderr.trim() : String(recoveryErr);
        throw new WorkspaceError(
          `git worktree add ${branch} into ${target} failed: ${err.stderr.trim()}; recovery: ${recoveryStderr}`,
        );
      }
    }

    await git(['remote', 'set-url', 'origin', connection.cloneUrl], { cwd: target }).catch(
      () => undefined,
    );

    const head = (await git(['rev-parse', 'HEAD'], { cwd: target })).trim();
    return {
      path: target,
      kind: 'fixed-branch',
      head,
      branchName: branch,
      remoteBranchExisted: true,
    };
  });
}

async function ensureBaseClone(bare: string, connection: ConnectionContext): Promise<void> {
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
  await git(['remote', 'set-url', 'origin', connection.cloneUrl], { cwd: bare }).catch(
    () => undefined,
  );
}

async function fetchWithAuth(bare: string, connection: ConnectionContext): Promise<void> {
  // Fetch into `refs/remotes/origin/*`, never `refs/heads/*` — the base clone
  // is shared and hosts worktrees, and git refuses to update a ref that any
  // worktree has checked out. See the longer note in `ticket-branch.ts`.
  const remote = connection.token ? withTokenUrl(connection) : 'origin';
  await git(['fetch', '--prune', remote, '+refs/heads/*:refs/remotes/origin/*'], { cwd: bare });
}

async function remoteBranchExists(bare: string, branchName: string): Promise<boolean> {
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
