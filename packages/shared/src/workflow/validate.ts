import { isTicketBranchWorkflow } from './identity';
import type { WorkflowDefinition } from './definition';

/**
 * Save-time validation on top of the Zod schema. Keeps the schema focused
 * on *structure* (discriminated unions, field presence) and puts
 * referential / semantic checks here.
 *
 * Starts narrow (Phase 5 rules only) — broader checks from
 * docs/design-docs/node-system.md "Validation rules" land here as we need
 * them.
 */
export interface WorkflowValidationIssue {
  code:
    | 'ticket-branch-requires-issue-trigger'
    | 'ticket-branch-rejects-board-column-webhook';
  message: string;
  /** Optional node name the issue is attached to, for UI highlighting. */
  nodeName?: string;
}

export class WorkflowValidationError extends Error {
  override readonly name = 'WorkflowValidationError';
  constructor(public readonly issues: WorkflowValidationIssue[]) {
    super(`Workflow validation failed: ${issues.map((i) => i.message).join('; ')}`);
  }
}

/**
 * Events whose normalized `TriggerEvent` carries a populated `issue.key`.
 * Must stay in lockstep with `normalizeGithubWebhook` in
 * `@conduit/shared/webhook`.
 */
const ISSUE_CARRYING_WEBHOOK_EVENTS = new Set([
  'issues.opened',
  'pull_request.opened',
  'issue_comment.created',
]);

export function validateWorkflowDefinition(definition: WorkflowDefinition): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];

  if (isTicketBranchWorkflow(definition)) {
    const trigger = definition.trigger;
    const ticketBranchNodes = definition.nodes
      .filter((n) => n.workspace.kind === 'ticket-branch')
      .map((n) => n.name);

    if (trigger.mode.kind === 'webhook') {
      const event = trigger.mode.event;
      if (event === 'board.column.changed') {
        for (const nodeName of ticketBranchNodes) {
          issues.push({
            code: 'ticket-branch-rejects-board-column-webhook',
            message:
              `Node "${nodeName}" uses ticket-branch but the trigger is a board.column.changed webhook, ` +
              `which carries no issue identifier. Use polling mode instead — see docs/design-docs/branch-management.md.`,
            nodeName,
          });
        }
      } else if (!ISSUE_CARRYING_WEBHOOK_EVENTS.has(event)) {
        for (const nodeName of ticketBranchNodes) {
          issues.push({
            code: 'ticket-branch-requires-issue-trigger',
            message:
              `Node "${nodeName}" uses ticket-branch but the trigger's webhook event "${event}" ` +
              `does not carry an issue identifier. Supported webhook events: ${[...ISSUE_CARRYING_WEBHOOK_EVENTS].join(', ')}.`,
            nodeName,
          });
        }
      }
    }
    // Polling triggers always produce `issue.key` from the GraphQL response —
    // no per-event validation needed on that path.
  }

  return issues;
}

export function assertValidWorkflowDefinition(definition: WorkflowDefinition): void {
  const issues = validateWorkflowDefinition(definition);
  if (issues.length > 0) throw new WorkflowValidationError(issues);
}
