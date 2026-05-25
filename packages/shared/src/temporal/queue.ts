/**
 * Default Temporal task queue name. Both the API (which starts workflows)
 * and the worker (which polls them) must agree — keep the literal here.
 */
export const DEFAULT_TEMPORAL_TASK_QUEUE = 'conduit-workflows';

/**
 * Workflow-type registry. The literal strings here are the contract between
 * the API (which starts workflows / creates schedules) and the worker (which
 * registers the workflow implementations). Keeping them in one place avoids
 * drift.
 */
export const AGENT_WORKFLOW_TYPE = 'agentWorkflow';
export const POLL_WORKFLOW_TYPE = 'pollWorkflow';
export const CRON_WORKFLOW_TYPE = 'cronWorkflow';

/**
 * Deterministic id for the Temporal Schedule driving any schedule-backed
 * workflow (polling or cron). One schedule per Conduit workflow — the
 * action (poll vs cron) is chosen at upsert time by the trigger variant.
 * The `poll-` prefix is preserved for backwards compatibility with any
 * schedules already in the Temporal namespace.
 */
export function workflowScheduleId(workflowId: string): string {
  return `poll-${workflowId}`;
}

/**
 * Deterministic Temporal workflow id for a poll run. Scoped by workflow id
 * only — overlap policy on the schedule (SKIP) is what prevents two poll
 * cycles from running concurrently for the same Conduit workflow.
 */
export function pollWorkflowId(workflowId: string): string {
  return `poll-run-${workflowId}`;
}

/**
 * Deterministic Temporal workflow id for a cron tick. Same shape as
 * `pollWorkflowId` so the schedule overlap policy (SKIP) prevents a slow
 * agent run from overlapping its successor tick.
 */
export function cronWorkflowId(workflowId: string): string {
  return `cron-run-${workflowId}`;
}

/**
 * Temporal workflow id for an `agentWorkflow` start.
 *
 *   - `ticket-branch` workflows → `run-<workflowId>-<ticketKey>`. Deterministic
 *     per `(Conduit workflow, ticket)` so a duplicate trigger while a run is
 *     in flight collides with the in-flight ID and Temporal rejects the
 *     start with `WorkflowExecutionAlreadyStarted`. After termination the
 *     ID is reusable (see `WorkflowIdReusePolicy.ALLOW_DUPLICATE` in the
 *     API/worker) so Dev → Review → Dev board cycles re-fire the Worker.
 *
 *   - All other workflows → `run-<runId>`. Per-run uniqueness; no dedup.
 */
export function agentWorkflowId(runId: string, ticketLock?: TicketLock): string {
  if (ticketLock) return `run-${ticketLock.workflowId}-${ticketLock.ticketKey}`;
  return `run-${runId}`;
}

/** Dedup key for `ticket-branch` workflow starts. See `agentWorkflowId`. */
export interface TicketLock {
  workflowId: string;
  ticketKey: string;
}
