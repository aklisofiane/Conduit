import { z } from 'zod';
import { triggerSourceSchema } from '../platform/index.js';

/**
 * Normalized event produced by every trigger mode (webhook, polling, manual).
 * Passed to every downstream node as `AgentContext.trigger`.
 *
 * `issue.id` is the platform's opaque identifier (e.g. GitHub `node_id`).
 * `issue.key` is the user-visible identifier as a string — `"42"` for GitHub,
 * `"PROJ-123"` for Jira. Anything needing a stable human-readable ticket id
 * (branch names, DB keys, Temporal workflow IDs) reads `issue.key`.
 */
export const triggerEventSchema = z.object({
  source: triggerSourceSchema,
  mode: z.enum(['webhook', 'polling', 'manual']),
  event: z.string().min(1),
  payload: z.record(z.unknown()),
  repo: z
    .object({
      owner: z.string().min(1),
      name: z.string().min(1),
    })
    .optional(),
  issue: z
    .object({
      id: z.string().min(1),
      key: z.string().min(1),
      title: z.string(),
      url: z.string().url(),
    })
    .optional(),
  actor: z.string().optional(),
});
export type TriggerEvent = z.infer<typeof triggerEventSchema>;
