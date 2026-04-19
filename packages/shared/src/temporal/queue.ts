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

/**
 * Deterministic id for the Temporal Schedule driving a polling workflow.
 * One schedule per Conduit workflow. Used by both the API (to create/update/
 * delete) and ops (to find the schedule in the Temporal UI).
 */
export function pollScheduleId(workflowId: string): string {
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
