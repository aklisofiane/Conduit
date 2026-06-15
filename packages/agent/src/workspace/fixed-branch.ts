import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkspaceError } from '../errors/index';
import { git } from './git';
import {
  addTrackingWorktree,
  ensureBaseClone,
  fetchWithAuth,
  remoteBranchExists,
  stripRemoteAuth,
} from './git-helpers';
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

    await addTrackingWorktree(bare, target, branch);
    await stripRemoteAuth(target, connection.cloneUrl);

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
