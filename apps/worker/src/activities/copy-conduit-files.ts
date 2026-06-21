import { copyConduitSummaries, touchWorktreeHeartbeat } from '@conduit/agent';
import { writeSystemLog } from '../runtime/log-writer';

export interface CopyConduitFilesInput {
  runId: string;
  /** Tenant scope — stamped onto the system log row this activity writes. */
  orgId: string;
  /** Source workspaces — one per parallel sibling that wrote a summary. */
  sources: Array<{ nodeName: string; workspacePath: string }>;
  /** Target workspace — the merged upstream workspace downstream nodes will see. */
  targetWorkspacePath: string;
  /**
   * Node name of the merged upstream — used as the `nodeName` on the
   * emitted system log entry so it attaches to the right timeline.
   */
  targetNodeName: string;
}

/**
 * After a parallel group merges back, copy each sibling's
 * `.conduit/<NodeName>.md` into the upstream's `.conduit/` folder so
 * downstream nodes see every sibling's summary in the merged workspace.
 * `.conduit/` is gitignored — the git merge doesn't carry it, which is
 * exactly why this activity exists.
 */
export async function copyConduitFilesActivity(input: CopyConduitFilesInput): Promise<void> {
  const { runId, orgId, sources, targetWorkspacePath, targetNodeName } = input;
  if (sources.length === 0) return;
  // Refresh the target worktree's liveness heartbeat — this runs in the
  // inter-node gap after a merge, covering it against a concurrent
  // same-branch resolve that would otherwise see a stale owner.
  await touchWorktreeHeartbeat(targetWorkspacePath);
  const copied = await copyConduitSummaries(sources, targetWorkspacePath);
  await writeSystemLog(
    runId,
    orgId,
    targetNodeName,
    `copied .conduit/ summaries: ${copied.join(', ') || '(none)'}`,
  );
}
