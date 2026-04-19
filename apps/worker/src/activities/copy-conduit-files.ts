import { copyConduitSummaries } from '@conduit/agent';
import { writeSystemLog } from '../runtime/log-writer';

export interface CopyConduitFilesInput {
  runId: string;
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
  const { runId, sources, targetWorkspacePath, targetNodeName } = input;
  if (sources.length === 0) return;
  const copied = await copyConduitSummaries(sources, targetWorkspacePath);
  await writeSystemLog(
    runId,
    targetNodeName,
    `copied .conduit/ summaries: ${copied.join(', ') || '(none)'}`,
  );
}
