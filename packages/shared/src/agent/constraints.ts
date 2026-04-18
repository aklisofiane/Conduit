import { z } from 'zod';

/**
 * Budget caps enforced inside the provider adapter (counts events, throws
 * `ConstraintExceededError` on breach). `timeoutSec` is enforced both as a
 * Temporal activity `startToCloseTimeout` and a provider wall-clock guard.
 */
export const agentConstraintsSchema = z.object({
  maxTurns: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  timeoutSec: z.number().int().positive().optional(),
  maxToolCalls: z.number().int().positive().optional(),
});
export type AgentConstraints = z.infer<typeof agentConstraintsSchema>;
