import { isTerminalRunStatus } from '@conduit/shared/workflow';
import { prisma } from '../prisma';

/**
 * Shared orphan classification for the boot-time sweeps (`docker-admin.ts`
 * and `process-admin.ts`): a run is orphaned when its status is terminal
 * or its row no longer exists — in either case the runner tracking it has
 * nothing left to do.
 *
 * Returns `null` when the DB lookup fails. Callers must skip their sweep
 * on `null` rather than treat the runs as missing: a transient DB outage
 * at boot must not make every live runner look orphaned and get killed.
 */
export async function findOrphanedRunIds(runIds: string[]): Promise<Set<string> | null> {
  let rows: Array<{ id: string; status: string }>;
  try {
    rows = await prisma().workflowRun.findMany({
      where: { id: { in: runIds } },
      select: { id: true, status: true },
    });
  } catch {
    return null;
  }
  const statusByRun = new Map(rows.map((r) => [r.id, r.status]));
  const orphaned = new Set<string>();
  for (const runId of runIds) {
    const status = statusByRun.get(runId);
    if (status === undefined || isTerminalRunStatus(status)) orphaned.add(runId);
  }
  return orphaned;
}
