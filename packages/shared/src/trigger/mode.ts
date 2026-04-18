import { z } from 'zod';

/**
 * How a trigger activates the workflow.
 *
 * - `webhook` — platform pushes events to `POST /api/hooks/:workflowId`.
 * - `polling` — Conduit polls the platform API every `intervalSec` seconds,
 *   diffing results against the last `PollSnapshot` for dedup.
 */
export const triggerModeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('webhook'),
    event: z.string().min(1),
    active: z.boolean(),
  }),
  z.object({
    kind: z.literal('polling'),
    intervalSec: z.number().int().positive(),
    active: z.boolean(),
  }),
]);
export type TriggerMode = z.infer<typeof triggerModeSchema>;
