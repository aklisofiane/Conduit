import { WorkspaceError } from '../errors/index';
import { addTrackingWorktree, remoteBranchExists } from './git-helpers';
import { resolveBranchWorkspace } from './resolve-branch';
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
 * Shares the lock/clone/fetch/strip scaffolding with `resolveTicketBranchWorkspace`
 * via `resolveBranchWorkspace`; the only difference is the `land` step has no
 * row upsert, no slug derivation, and no PR fallback. The branch must already
 * exist on the remote — cron has no notion of "creating" the branch.
 */
export async function resolveFixedBranchWorkspace(
  input: FixedBranchResolveInput,
): Promise<ResolvedWorkspace> {
  const { runId, nodeName, connection, branch } = input;
  return resolveBranchWorkspace({
    runId,
    nodeName,
    connection,
    land: async ({ bare, target }) => {
      if (!(await remoteBranchExists(bare, branch))) {
        throw new WorkspaceError(
          `fixed-branch workspace on node "${nodeName}" references branch "${branch}" which does not exist on ${connection.owner}/${connection.repo}.`,
        );
      }
      await addTrackingWorktree(bare, target, branch);
      return { kind: 'fixed-branch', branchName: branch, remoteBranchExisted: true };
    },
  });
}
