import { z } from 'zod';
import { triggerEventSchema } from '../trigger/index';

/**
 * Context passed to every agent invocation. Delivered as the provider
 * request's *user message* (serialized JSON); the node's `instructions`
 * become the *system prompt* verbatim.
 *
 * Upstream agent context is **not** injected here — downstream agents read
 * `.conduit/<UpstreamNode>.md` from the workspace instead. See
 * docs/design-docs/agent-context.md.
 */
export const agentContextSchema = z.object({
  trigger: triggerEventSchema,
  workflow: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
  }),
  run: z.object({
    id: z.string().min(1),
    startedAt: z.string().datetime(),
  }),
});
export type AgentContext = z.infer<typeof agentContextSchema>;
