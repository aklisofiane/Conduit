import type { WorkflowDefinition } from './definition';

/**
 * Save-time validation on top of the Zod schema. Keeps the schema focused
 * on *structure* (discriminated unions, field presence) and puts
 * referential / semantic checks here.
 *
 * v1 is ticket/PR-anchored: every workflow targets exactly one repo
 * connection, every trigger must surface an issue or PR identifier, and
 * graph-derived workspaces enforce inheritance from a real upstream node.
 */
export interface WorkflowValidationIssue {
  code:
    | 'trigger-requires-issue-or-pr'
    | 'triggers-must-share-connection'
    | 'trigger-board-connection-required'
    | 'triggers-must-share-board-connection';
  message: string;
  /** Optional node name (or trigger name) the issue is attached to, for UI highlighting. */
  nodeName?: string;
}

export class WorkflowValidationError extends Error {
  override readonly name = 'WorkflowValidationError';
  constructor(public readonly issues: WorkflowValidationIssue[]) {
    super(`Workflow validation failed: ${issues.map((i) => i.message).join('; ')}`);
  }
}

/**
 * Webhook events whose normalized `TriggerEvent` carries an issue or PR
 * identifier. Must stay in lockstep with `normalizeGithubWebhook` in
 * `@conduit/shared/webhook`. `board.column.changed` is intentionally
 * excluded — its payload carries no issue number, so polling is the
 * supported mode for board loops.
 */
const ISSUE_OR_PR_WEBHOOK_EVENTS = new Set([
  'issues.opened',
  'pull_request.opened',
  'issue_comment.created',
]);

/** Trigger modes whose semantics require a board connection. */
function modeRequiresBoardConnection(
  mode: WorkflowDefinition['triggers'][number]['mode'],
): boolean {
  if (mode.kind === 'polling') {
    return mode.scope === 'issues' && mode.source === 'board';
  }
  return mode.event === 'board.column.changed';
}

export function validateWorkflowDefinition(
  definition: WorkflowDefinition,
): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];

  const triggers = definition.triggers;
  if (triggers.length === 0) return issues;

  // Rule: every trigger must surface an issue or PR identifier — Conduit
  // is ticket/PR-driven in v1. Polling on a project board always pulls
  // issue identity from the GraphQL response, so polling mode is allowed
  // unconditionally; webhooks are restricted to the issue/PR event set.
  for (const trigger of triggers) {
    if (trigger.mode.kind === 'polling') continue;
    const event = trigger.mode.event;
    if (!ISSUE_OR_PR_WEBHOOK_EVENTS.has(event)) {
      issues.push({
        code: 'trigger-requires-issue-or-pr',
        message:
          `Trigger "${trigger.name}" uses webhook event "${event}", which carries no issue or PR identifier. ` +
          `Supported webhook events: ${[...ISSUE_OR_PR_WEBHOOK_EVENTS].join(', ')}; ` +
          `or use polling mode for board-status workflows.`,
        nodeName: trigger.name,
      });
    }
  }

  // Rule: a trigger whose mode targets a board must carry a
  // boardConnectionId so the resolver knows which board to query. Webhook
  // triggers on `board.column.changed` need the board for the same reason
  // (filter + identity resolution against the project graph).
  for (const trigger of triggers) {
    if (modeRequiresBoardConnection(trigger.mode) && !trigger.boardConnectionId) {
      issues.push({
        code: 'trigger-board-connection-required',
        message:
          `Trigger "${trigger.name}" targets a project board but is missing a boardConnectionId.`,
        nodeName: trigger.name,
      });
    }
  }

  // Rule: a workflow targets exactly one repo connection, so every trigger
  // must reference the same connectionId. v1 has a single trigger today,
  // but the rule is written for the multi-trigger future without changing.
  const distinctConnectionIds = new Set(triggers.map((t) => t.connectionId));
  if (distinctConnectionIds.size > 1) {
    issues.push({
      code: 'triggers-must-share-connection',
      message: `All triggers in a workflow must reference the same connectionId — found ${distinctConnectionIds.size} distinct connections.`,
    });
  }

  // Rule: at most one board connection across the workflow's triggers. A
  // workflow targets one source + one board; multiple triggers all key off
  // the same pair. Triggers without a board contribute `undefined` and are
  // ignored.
  const distinctBoardConnectionIds = new Set(
    triggers
      .map((t) => t.boardConnectionId)
      .filter((id): id is string => Boolean(id)),
  );
  if (distinctBoardConnectionIds.size > 1) {
    issues.push({
      code: 'triggers-must-share-board-connection',
      message: `All triggers in a workflow must reference the same boardConnectionId — found ${distinctBoardConnectionIds.size} distinct board connections.`,
    });
  }

  return issues;
}

export function assertValidWorkflowDefinition(definition: WorkflowDefinition): void {
  const issues = validateWorkflowDefinition(definition);
  if (issues.length > 0) throw new WorkflowValidationError(issues);
}
