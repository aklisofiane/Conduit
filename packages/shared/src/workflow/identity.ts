import type { TriggerEvent } from '../trigger/event';
import type { WorkflowDefinition } from './definition';
import type { TicketLock } from '../temporal/queue';

/**
 * True for every well-formed workflow in v1 — every workflow has at least
 * one trigger feeding a node, and graph-derived workspaces always make
 * trigger-connected nodes `ticket-branch`. The function survives Phase 2
 * because callers (Temporal id construction, validators) still want a
 * single yes/no signal even though the answer is now "yes if there's a
 * trigger." Empty-trigger / empty-node definitions return `false` so
 * incomplete drafts on the canvas don't pretend to be ticket-locked.
 */
export function isTicketBranchWorkflow(definition: WorkflowDefinition): boolean {
  return definition.triggers.length > 0 && definition.nodes.length > 0;
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
