import { z } from 'zod';

/**
 * Streaming event emitted by a provider during an agent run. One row is
 * appended to `ExecutionLog` per event; the same event is published to
 * Redis `conduit:run-updates` for the live run-detail UI.
 */
export const agentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), delta: z.string() }),
  z.object({
    type: z.literal('tool_call'),
    id: z.string().min(1),
    name: z.string().min(1),
    input: z.unknown(),
  }),
  z.object({
    type: z.literal('tool_result'),
    id: z.string().min(1),
    output: z.unknown(),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal('usage'),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('done') }),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;
