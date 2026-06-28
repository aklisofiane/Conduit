import { baseClonePath, defaultBranch, ensureBaseClone, fetchWithAuth } from '@conduit/agent';
import type { TriggerSource } from '@conduit/shared';
import { loadConnectionContext } from '../runtime/connection-context';

export interface CloneAnalysisWorkspaceInput {
  connectionId: string;
}

export interface CloneAnalysisWorkspaceResult {
  repo: { owner: string; name: string };
  platform: TriggerSource;
  /** The repo's default branch — the read-only `fixed-branch` the Discover
   *  node clones, and the branch baked into every generated cron trigger. */
  defaultBranch: string;
}

/**
 * Prime the analysis: ensure (and fetch) the base bare clone for the
 * connection's repo once, and report its default branch. The Discover node's
 * `fixed-branch` workspace and every Design node's branched worktree resolve
 * off this same base clone, so this is purely a one-time warm-up + default
 * branch probe — no worktree is created here. Idempotent under Temporal
 * retries (`ensureBaseClone` no-ops when the clone exists).
 */
export async function cloneAnalysisWorkspaceActivity(
  input: CloneAnalysisWorkspaceInput,
): Promise<CloneAnalysisWorkspaceResult> {
  const connection = await loadConnectionContext(input.connectionId);
  if (!connection) {
    throw new Error(
      `analysis connection ${input.connectionId} is missing or not repo-scoped`,
    );
  }
  const bare = baseClonePath(
    connection.platform,
    connection.host,
    connection.owner,
    connection.repo,
  );
  await ensureBaseClone(bare, connection);
  await fetchWithAuth(bare, connection);
  const branch = await defaultBranch(bare);
  return {
    repo: { owner: connection.owner, name: connection.repo },
    platform: connection.platform,
    defaultBranch: branch,
  };
}
