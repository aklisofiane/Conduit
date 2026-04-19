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
