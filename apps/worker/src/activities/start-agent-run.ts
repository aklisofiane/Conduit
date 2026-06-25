import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import {
  AGENT_WORKFLOW_TYPE,
  agentWorkflowId,
  type TicketLock,
  type TriggerEvent,
} from '@conduit/shared';
import { errorMessage } from '@conduit/shared/runtime';
import { config } from '../config';
import { prisma } from '../runtime/prisma';
import { writeSystemLog } from '../runtime/log-writer';
import { getTemporalClient } from '../runtime/temporal-client';

/**
 * Outcome of attempting to start one `agentWorkflow`. `duplicate` means a
 * concurrent Conduit start already holds the Temporal workflow id (ticket
 * dedup) and this attempt was dropped; the placeholder `WorkflowRun` row has
 * already been deleted. `error` carries the normalized message and leaves the
 * row marked `FAILED`.
 */
export type StartAgentRunResult =
  | { status: 'started'; runId: string }
  | { status: 'duplicate' }
  | { status: 'error'; runId: string; error: string };

/**
 * Create the placeholder `WorkflowRun` row, start the Temporal `agentWorkflow`,
 * and reconcile the row's status. Shared by the poll and cron trigger surfaces
 * — the only thing that varies is the `TicketLock` (cron has none) and the log
 * label, so callers pass those and adapt the discriminated result to their own
 * return shape.
 */
export async function startAgentRun(params: {
  workflowId: string;
  orgId: string;
  triggerEvent: TriggerEvent;
  /** Frozen slug used as the cosmetic Temporal-id prefix. */
  slug?: string;
  /** Present only for ticket-branch triggers; drives start-time dedup. */
  ticketLock?: TicketLock;
  /** Activity name prefix for the failure system-log (e.g. `pollBoardActivity`). */
  logLabel: string;
}): Promise<StartAgentRunResult> {
  const { workflowId, orgId, triggerEvent, slug, ticketLock, logLabel } = params;
  const run = await prisma().workflowRun.create({
    data: {
      workflowId,
      orgId,
      status: 'PENDING',
      trigger: triggerEvent as unknown as object,
    },
  });
  try {
    const client = await getTemporalClient();
    // Read-only: the slug was frozen by the API when the schedule was created.
    // Never recompute from the live name — that would diverge from the frozen
    // value and break ticket-branch dedup against an in-flight run.
    const temporalWorkflowId = agentWorkflowId(run.id, ticketLock, slug);
    const handle = await client.workflow.start(AGENT_WORKFLOW_TYPE, {
      args: [{ workflowId, runId: run.id, triggerEvent }],
      taskQueue: config.temporal.taskQueue,
      workflowId: temporalWorkflowId,
    });
    await prisma().workflowRun.update({
      where: { id: run.id },
      data: {
        status: 'RUNNING',
        temporalWorkflowId,
        temporalRunId: handle.firstExecutionRunId,
      },
    });
    return { status: 'started', runId: run.id };
  } catch (err) {
    if (err instanceof WorkflowExecutionAlreadyStartedError) {
      // Another Conduit start is in flight for this ticket — drop this one.
      await prisma()
        .workflowRun.delete({ where: { id: run.id } })
        .catch(() => undefined);
      return { status: 'duplicate' };
    }
    const error = errorMessage(err);
    await prisma()
      .workflowRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', error, finishedAt: new Date() },
      })
      .catch(() => undefined);
    await writeSystemLog(
      run.id,
      orgId,
      null,
      `${logLabel}: failed to start agentWorkflow: ${error}`,
      'ERROR',
    ).catch(() => undefined);
    return { status: 'error', runId: run.id, error };
  }
}
