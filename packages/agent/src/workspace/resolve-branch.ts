import fs from 'node:fs/promises';
import path from 'node:path';
import { git } from './git';
import { ensureBaseClone, fetchWithAuth, stripRemoteAuth } from './git-helpers';
import { withPathLock } from './lock';
import { baseClonePath, nodeWorkspacePath } from './paths';
import { dropConflictingWorktrees } from './worktree-cleanup';
import type { ConnectionContext, ResolvedWorkspace } from './types';

/** What the per-trigger middle step must return after landing the worktree. */
export interface LandedBranch {
  kind: ResolvedWorkspace['kind'];
  branchName: string;
  remoteBranchExisted: boolean;
  /** Populated for issue-anchored ticket-branch runs. */
  ticketBranchId?: string;
}

export interface ResolveBranchWorkspaceInput {
  runId: string;
  nodeName: string;
  connection: ConnectionContext;
  /**
   * Lands the worktree on the right branch and reports back. Runs inside the
   * base-clone lock, after the clone is ensured/fetched and the target's
   * parent dir exists — i.e. it only has to add the worktree (and any
   * trigger-specific row upsert / existence check).
   */
  land: (ctx: { bare: string; target: string }) => Promise<LandedBranch>;
}

/**
 * Shared scaffolding for branch-backed workspace resolution (fixed-branch and
 * ticket-branch). Holds the fragile, order-sensitive prologue/epilogue in one
 * place; the only per-trigger variation is the `land` step in the middle:
 *
 *   1. Take the base-clone mutex — serializes concurrent worktree adds from
 *      retries or cross-workflow races on the same repo.
 *   2. Ensure the base bare clone exists.
 *   3. Drop any conflicting worktree *before* fetching: a crashed prior
 *      attempt can leave git thinking the branch is checked out, which makes
 *      the fetch refuse ("refusing to fetch into branch X checked out at Y").
 *   4. Fetch remote heads (tokenized URL) and create the target's parent dir.
 *   5. `land()` — add the worktree on the trigger's branch.
 *   6. Strip auth from the worktree's remote and read HEAD.
 *
 * Idempotent under Temporal retries: a re-entry takes the lock, repeats the
 * drop + fetch + add, and produces the same checkout without leaking worktree
 * registrations.
 */
export async function resolveBranchWorkspace(
  input: ResolveBranchWorkspaceInput,
): Promise<ResolvedWorkspace> {
  const { runId, nodeName, connection, land } = input;
  const bare = baseClonePath(connection.platform, connection.host, connection.owner, connection.repo);
  const target = nodeWorkspacePath(runId, nodeName);

  return withPathLock(bare, async () => {
    await ensureBaseClone(bare, connection);
    await dropConflictingWorktrees(bare, target);
    await Promise.all([
      fetchWithAuth(bare, connection),
      fs.mkdir(path.dirname(target), { recursive: true }),
    ]);

    const landed = await land({ bare, target });

    await stripRemoteAuth(target, connection.cloneUrl);
    const head = (await git(['rev-parse', 'HEAD'], { cwd: target })).trim();

    return {
      path: target,
      kind: landed.kind,
      head,
      branchName: landed.branchName,
      remoteBranchExisted: landed.remoteBranchExisted,
      ...(landed.ticketBranchId ? { ticketBranchId: landed.ticketBranchId } : {}),
    };
  });
}
