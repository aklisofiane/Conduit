import { deriveWorkspaces } from './derive-workspace';
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
    | 'triggers-must-share-board-connection'
    | 'cron-trigger-incompatible-workspace'
    | 'gitlab-trigger-board-unsupported';
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
 * excluded — its payload carries no issue number, so an issues-type
 * polling trigger is the supported path for board loops.
 */
const ISSUE_OR_PR_WEBHOOK_EVENTS = new Set([
  'issues.opened',
  'pull_request.opened',
  'issue_comment.created',
]);

export function validateWorkflowDefinition(
  definition: WorkflowDefinition,
): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];

  const triggers = definition.triggers;
  if (triggers.length === 0) return issues;

  // Rule: every trigger must surface an issue or PR identifier — Conduit
  // is ticket/PR-driven in v1. Polling triggers always pull issue identity
  // from the platform response, so they're allowed unconditionally;
  // webhooks are restricted to the issue/PR event set.
  for (const trigger of triggers) {
    if (trigger.type !== 'webhook') continue;
    const event = trigger.event;
    if (!ISSUE_OR_PR_WEBHOOK_EVENTS.has(event)) {
      issues.push({
        code: 'trigger-requires-issue-or-pr',
        message:
          `Trigger "${trigger.name}" uses webhook event "${event}", which carries no issue or PR identifier. ` +
          `Supported webhook events: ${[...ISSUE_OR_PR_WEBHOOK_EVENTS].join(', ')}; ` +
          `or use a polling trigger for board-status workflows.`,
        nodeName: trigger.name,
      });
    }
  }

  // Rule: a `board.column.changed` webhook needs a boardConnectionId so the
  // resolver knows which board's column event to interpret. Polling triggers
  // derive board-vs-repo behavior from `boardConnectionId` presence itself,
  // so this rule no longer fires for polling.
  for (const trigger of triggers) {
    if (
      trigger.type === 'webhook' &&
      trigger.event === 'board.column.changed' &&
      !trigger.boardConnectionId
    ) {
      issues.push({
        code: 'trigger-board-connection-required',
        message:
          `Trigger "${trigger.name}" listens for board.column.changed but is missing a boardConnectionId.`,
        nodeName: trigger.name,
      });
    }
  }

  // Rule: GitLab triggers do not support boards in this release. Reject
  // boardConnectionId at save time so the worker never sees it.
  for (const trigger of triggers) {
    if (trigger.platform === 'gitlab' && trigger.boardConnectionId) {
      issues.push({
        code: 'gitlab-trigger-board-unsupported',
        message:
          `Trigger "${trigger.name}" is a GitLab trigger with a boardConnectionId. ` +
          `GitLab triggers do not support boards in this release.`,
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

  // Rule: a cron upstream produces a `fixed-branch` workspace; any node
  // downstream that's still saved as `ticket-branch` is incoherent.
  // `deriveWorkspaces` fixes this for fresh definitions; this catches
  // legacy or hand-edited JSON where the workspace was authored by hand.
  const triggerNames = new Set(triggers.map((t) => t.name));
  const cronTriggerNames = new Set(
    triggers.filter((t) => t.type === 'cron').map((t) => t.name),
  );
  if (cronTriggerNames.size > 0) {
    const derived = deriveWorkspaces(definition);
    const cronEntryNodes = new Set<string>();
    for (const edge of definition.edges) {
      if (cronTriggerNames.has(edge.from)) cronEntryNodes.add(edge.to);
    }
    for (const node of derived.nodes) {
      if (!cronEntryNodes.has(node.name)) continue;
      // Skip if any *non-cron* trigger also feeds this node — mixed-trigger
      // setups are rejected elsewhere (shared-connection rule), and the
      // workspace shape they pick is unsupported anyway.
      const upstreamTriggerNames = definition.edges
        .filter((e) => e.to === node.name && triggerNames.has(e.from))
        .map((e) => e.from);
      const hasNonCronTrigger = upstreamTriggerNames.some(
        (name) => !cronTriggerNames.has(name),
      );
      if (hasNonCronTrigger) continue;
      // The legacy/hand-edited check: stored workspace is ticket-branch
      // despite a cron upstream.
      if (node.workspace?.kind === 'ticket-branch') {
        issues.push({
          code: 'cron-trigger-incompatible-workspace',
          message:
            `Node "${node.name}" has workspace kind "ticket-branch" but its upstream is a cron trigger. ` +
            `Cron triggers produce "fixed-branch" workspaces; remove the workspace override so it derives from the trigger.`,
          nodeName: node.name,
        });
      }
    }
  }

  return issues;
}

export function assertValidWorkflowDefinition(definition: WorkflowDefinition): void {
  const issues = validateWorkflowDefinition(definition);
  if (issues.length > 0) throw new WorkflowValidationError(issues);
}
