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
    /**
     * Full-rate (non-cached) input tokens for this turn. Cache-read and
     * cache-write tokens are tracked separately below so cost can price each
     * bucket at its own rate. Providers normalize to this shape: Claude's
     * `result.usage.input_tokens` already excludes cache; Codex's per-turn
     * `input_tokens` includes cache, so the adapter subtracts `cached_input_tokens`.
     */
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    /** Cached input tokens served at the cache-read rate (~0.1× input). */
    cachedInputTokens: z.number().int().nonnegative().optional(),
    /** Input tokens that wrote new cache entries (Claude only; ~1.25× input). */
    cacheCreationInputTokens: z.number().int().nonnegative().optional(),
    /**
     * Reasoning tokens — a *subset* of `outputTokens`, surfaced for display
     * only. Never add it to `outputTokens` or to a total: the provider's
     * `outputTokens` already includes it (OpenAI Responses semantics).
     */
    reasoningOutputTokens: z.number().int().nonnegative().optional(),
    /**
     * Provider-reported dollar cost (Claude's `total_cost_usd`). A running
     * session total — each turn already includes the prior turns — so the
     * consumer keeps the latest rather than summing. Absent for Codex, whose
     * cost is computed downstream from the per-model price table.
     */
    costUsd: z.number().nonnegative().optional(),
  }),
  z.object({ type: z.literal('done') }),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;
