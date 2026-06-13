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
 * parallel siblings. Returns empty string when the node has <2 immediate
 * downstreams.
 *
 * Only *immediate* fan-out is surfaced — the agent doesn't need transitive
 * DAG visibility to make a dispatch decision, and keeping the block tight
 * avoids polluting context for agents that don't care.
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
 * Auto-injected block, prepended to the *user turn* (`prompts.main`) of any
 * node with direct upstream agents. Renders each present predecessor summary
 * as a `### <NodeName>` subsection under a single `## Upstream context`
 * heading, body verbatim. Returns empty string when no summaries are present
 * so callers can prepend it unconditionally.
 *
 * Lives in the user turn — not the system prompt — because these are turn-1
 * *input data* (what upstream handed off), not role/behavior. Cf.
 * `formatParallelDownstreamBlock`, which is behavioral and stays in the system
 * prompt.
 */
export function formatUpstreamContextBlock(
  summaries: ReadonlyArray<{ nodeName: string; body: string }>,
): string {
  if (summaries.length === 0) return '';
  const sections = summaries.map(
    ({ nodeName, body }) => `### ${nodeName}\n\n${body}`,
  );
  return [
    '## Upstream context',
    '',
    'Handoff summaries from the agents that ran directly before you:',
    '',
    ...sections,
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
 * when the agent has `issueWriteback` configured and the run targets a
 * GitHub repo. Two shapes, picked by whether `issueNumber` is present:
 *
 *   - issue-anchored — the run was fired by a GitHub issue event (polling /
 *     webhook); the agent updates that one issue.
 *   - repo-scoped (`issueNumber` omitted) — e.g. a cron run, which has no
 *     triggering issue. The agent constrains the Status / labels it sets on
 *     whatever issues it creates or touches in the repo during the run (the
 *     nightly-review Publisher creating one issue per finding is the
 *     motivating case).
 *
 * The allowlist values are interpolated verbatim — only what the user picked
 * appears here, so the prompt itself encodes the choice set. Soft enforcement
 * only.
 *
 * `consumedLabels` are the stage labels the run was gated on (derived from the
 * trigger). The directive tells the agent to remove them now that the stage is
 * done, so a board handoff is a remove-old/add-new label swap without the
 * template describing the removal.
 *
 * `isPr` switches the wording to a pull request: the agent is told to use the
 * `gh pr` CLI (`gh pr edit` for labels, `gh pr close|reopen` for state) rather
 * than the issue-shaped `gh issue` path, and the `allowedPrStates` open/closed
 * directive is emitted. PR runs share the issue number space, so the anchor is
 * the same `owner/repo#N`. Labels and project Status carry over unchanged
 * (GitHub treats PRs as issues for labels; Status only emits if a board status
 * was picked, which the PR-trigger UI never offers).
 */
export function issueWritebackPrompt(args: {
  owner: string;
  repo: string;
  issueNumber?: string;
  allowedStatuses: string[];
  allowedLabels: string[];
  allowedPrStates?: string[];
  consumedLabels?: string[];
  isPr?: boolean;
}): string {
  const {
    owner,
    repo,
    issueNumber,
    allowedStatuses,
    allowedLabels,
    allowedPrStates = [],
    consumedLabels = [],
    isPr = false,
  } = args;
  const noun = isPr ? 'pull request' : 'issue';
  const statusLine =
    allowedStatuses.length > 0
      ? `- Set the project Status to whichever of these values best fits: ${allowedStatuses.map((s) => `"${s}"`).join(', ')}.`
      : null;
  // Open/closed is a repo-native PR state — no board needed. Emitted only for
  // PR-shaped runs; on issue/cron runs `allowedPrStates` is inert by config.
  const prStateLine =
    isPr && allowedPrStates.length > 0
      ? `- Set the pull request's open/closed state to whichever of these fits: ${allowedPrStates.map((s) => `"${s}"`).join(', ')}. Use \`gh pr close\` to close and \`gh pr reopen\` to reopen.`
      : null;
  const labelLine =
    allowedLabels.length > 0
      ? `- Apply whichever of these labels best fit (you may apply more than one, or none if none apply): ${allowedLabels.map((l) => `"${l}"`).join(', ')}.`
      : null;
  const removeLabelLine =
    consumedLabels.length > 0
      ? `- Remove the label that gated this run, now consumed: ${consumedLabels.map((l) => `"${l}"`).join(', ')}.`
      : null;
  const noopStatusLine = statusLine
    ? `- Do not set any project Status that isn't in the list above.`
    : null;
  const noopPrStateLine = prStateLine
    ? `- Don't move the pull request to any state that isn't listed above; if it's already in the right state, leave it.`
    : null;
  // Phrase the no-op guard to match the directives actually present, so a
  // pure-removal turn (labelLine null, removeLabelLine set) doesn't reference an
  // "apply" list that isn't there.
  const noopLabelLine =
    labelLine && removeLabelLine
      ? `- Leave every other label untouched — only apply and remove what's listed above.`
      : labelLine
        ? `- Leave every other label untouched — only apply what's listed above.`
        : removeLabelLine
          ? `- Leave every other label untouched — only remove what's listed above; don't add any new label.`
          : null;

  const header = issueNumber
    ? [
        `Final step before you finish: update the GitHub ${noun} this run was triggered by.`,
        ``,
        `${isPr ? 'PR' : 'Issue'}: ${owner}/${repo}#${issueNumber}`,
      ]
    : [
        `Final step before you finish: for every GitHub ${noun} you created or updated in ${owner}/${repo} during this run, constrain what you set as follows.`,
      ];

  const closing = issueNumber
    ? `- If none apply, say so explicitly and skip the update — don't pick a default.`
    : `- These constraints apply only to ${noun}s you touched this run. If you didn't create or update any ${noun}, skip this — don't invent one.`;

  const cliLine = isPr
    ? `Use the \`gh pr\` CLI available to you (\`gh pr edit\` for labels, \`gh pr close\` / \`gh pr reopen\` for state). Constraints:`
    : `Use the gh CLI available to you. Constraints:`;

  return [
    ...header,
    ``,
    cliLine,
    statusLine,
    prStateLine,
    labelLine,
    removeLabelLine,
    noopStatusLine,
    noopPrStateLine,
    noopLabelLine,
    closing,
    ``,
    `When done, briefly state what you set and why.`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}
