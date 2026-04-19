import type { TriggerEvent } from '../trigger/event';
import type { WorkflowDefinition } from './definition';
import type { TicketLock } from '../temporal/queue';

/**
 * True when the workflow contains at least one agent with a `ticket-branch`
 * workspace. These workflows get deterministic Temporal IDs keyed on the
 * ticket so concurrent triggers against an in-flight run collapse into one.
 */
export function isTicketBranchWorkflow(definition: WorkflowDefinition): boolean {
  return definition.nodes.some((n) => n.workspace.kind === 'ticket-branch');
}

/**
 * Resolve the `TicketLock` for a `ticket-branch` trigger event. Returns
 * undefined when the event carries no issue identifier — the validator
 * catches this at save time, but we fail soft at run time so the trigger
 * handler can log + drop rather than crashing the webhook endpoint.
 */
export function ticketLockFor(
  definition: WorkflowDefinition,
  workflowId: string,
  trigger: TriggerEvent,
): TicketLock | undefined {
  if (!isTicketBranchWorkflow(definition)) return undefined;
  const key = trigger.issue?.key;
  if (!key) return undefined;
  return { workflowId, ticketKey: key };
}
