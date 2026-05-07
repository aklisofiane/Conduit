import type { AgentContext, TriggerEvent } from '@conduit/shared';

/** Build the `AgentContext` handed to the provider as the user message. */
export function buildAgentContext(args: {
  trigger: TriggerEvent;
  workflow: { id: string; name: string };
  run: { id: string; startedAt: string | Date };
}): AgentContext {
  const startedAt =
    typeof args.run.startedAt === 'string' ? args.run.startedAt : args.run.startedAt.toISOString();
  return {
    trigger: args.trigger,
    workflow: args.workflow,
    run: { id: args.run.id, startedAt },
  };
}

/** Canonical JSON serialization — stable key order for easier diffing in logs. */
export function serializeAgentContext(ctx: AgentContext): string {
  return JSON.stringify(ctx, null, 2);
}

/**
 * Auto-injected suffix on the system prompt of any node that fans out into
 * parallel siblings. Empty string when the node has 0 or 1 immediate
 * downstream node — the runtime concats this onto `node.instructions` and a
 * `+ ''` is a no-op, so the rest of the agent's prompt stays clean.
 *
 * Only the *immediate* fan-out is surfaced — the agent doesn't need
 * transitive DAG visibility to make a dispatch decision, and keeping the
 * block tight avoids polluting context for agents that don't care.
 */
export function formatParallelDownstreamBlock(siblings: readonly string[]): string {
  if (siblings.length < 2) return '';
  const bullets = siblings.map((name) => `- ${name}`).join('\n');
  return [
    '## Parallel downstream',
    '',
    'This node fans out to siblings that run concurrently in branched worktrees:',
    bullets,
    '',
    'Each sibling gets its own copy of your workspace. Files you write to `.conduit/` are shared across them. Scope responsibilities so they do not stomp each other\'s files.',
  ].join('\n');
}

/**
 * Second-turn user message that asks the agent to record a summary for
 * downstream nodes. Written to `.conduit/<NodeName>.md` — the folder is
 * gitignored, ephemeral, and copied across parallel worktrees by the
 * runtime. See docs/design-docs/agent-context.md.
 */
export function finalSummaryPrompt(nodeName: string): string {
  return [
    `You have finished the main work for this node ("${nodeName}").`,
    ``,
    `Write a concise summary of what you did to \`.conduit/${nodeName}.md\` (use your file-write tool; create the directory if it doesn't exist).`,
    ``,
    `Include, as useful to downstream agents:`,
    `- what you did and why`,
    `- decisions, open questions, anything another agent should know`,
    `- files you changed (brief — the runtime records the full list separately)`,
    ``,
    `Keep it short. Plain markdown. No JSON. Do not repeat the task prompt.`,
  ].join('\n');
}

/**
 * Trailing user turn injected between the main turn and the summary turn
 * when the agent has `issueWriteback` configured and the run was triggered
 * by a GitHub issue event. The allowlist values are interpolated verbatim
 * — only what the user picked appears here, so the prompt itself encodes
 * the choice set. Soft enforcement only.
 */
export function issueWritebackPrompt(args: {
  owner: string;
  repo: string;
  issueNumber: string;
  allowedStatuses: string[];
  allowedLabels: string[];
}): string {
  const { owner, repo, issueNumber, allowedStatuses, allowedLabels } = args;
  const statusLine =
    allowedStatuses.length > 0
      ? `- Set the issue's project Status to whichever of these best fits what you just did: ${allowedStatuses.map((s) => `"${s}"`).join(', ')}.`
      : null;
  const labelLine =
    allowedLabels.length > 0
      ? `- Apply whichever of these labels best fit (you may apply more than one, or none if none apply): ${allowedLabels.map((l) => `"${l}"`).join(', ')}.`
      : null;
  const noopStatusLine = statusLine
    ? `- Do not set any project Status that isn't in the list above.`
    : null;
  const noopLabelLine = labelLine
    ? `- Do not apply any label that isn't in the list above.`
    : null;

  return [
    `Final step before you finish: update the GitHub issue this run was triggered by.`,
    ``,
    `Issue: ${owner}/${repo}#${issueNumber}`,
    ``,
    `Use the gh CLI available to you. Constraints:`,
    statusLine,
    labelLine,
    noopStatusLine,
    noopLabelLine,
    `- If none apply, say so explicitly and skip the update — don't pick a default.`,
    ``,
    `When done, briefly state what you set and why.`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}
