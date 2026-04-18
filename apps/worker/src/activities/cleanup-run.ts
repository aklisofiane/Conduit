import { WorkspaceManager } from '@conduit/agent';
import { prisma } from '../runtime/prisma';
import { writeSystemLog } from '../runtime/log-writer';

/**
 * End-of-workflow cleanup. Deletes workspace tmpdirs for the run; `.conduit/`
 * disappears with the workspace. Marks the `WorkflowRun` row as terminal
 * if it isn't already. Best-effort — swallows filesystem errors and logs.
 */
export async function cleanupRunActivity(input: {
  runId: string;
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED';
  error?: string;
}): Promise<void> {
  const { runId, status, error } = input;
  const manager = new WorkspaceManager();
  try {
    await manager.cleanupRun(runId);
  } catch (err) {
    await writeSystemLog(
      runId,
      null,
      `cleanupRun failed: ${err instanceof Error ? err.message : String(err)}`,
      'WARN',
    );
  }
  await prisma().workflowRun.update({
    where: { id: runId },
    data: {
      status,
      error: error ?? undefined,
      finishedAt: new Date(),
    },
  });
}
