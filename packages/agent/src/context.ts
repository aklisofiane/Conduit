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
