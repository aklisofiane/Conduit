import { z } from 'zod';
import { triggerSourceSchema } from '../platform/index';
import { triggerFilterSchema } from './filter';
import { triggerModeSchema } from './mode';

/**
 * Board reference — identifies a GitHub Projects v2 board (or the equivalent
 * on other platforms later). Required for polling-mode triggers and for
 * webhook triggers that read a board field (e.g. `projects_v2_item.edited`
 * status changes). Optional at the schema level so issue-centric triggers
 * (`issues.opened`, `pull_request.opened`) can omit it; presence is enforced
 * per mode in the workflow validator, not here.
 */
export const boardRefSchema = z.object({
  ownerType: z.enum(['user', 'org']),
  owner: z.string().min(1),
  // GitHub Projects v2 addresses projects by a numeric "project number"
  // scoped to the owner (org or user). Stored as the integer so the GraphQL
  // client doesn't have to re-parse a URL on every poll cycle.
  number: z.number().int().positive(),
});
export type BoardRef = z.infer<typeof boardRefSchema>;

/** Persisted trigger shape on `WorkflowDefinition.trigger`. */
export const triggerConfigSchema = z.object({
  platform: triggerSourceSchema,
  connectionId: z.string().min(1),
  mode: triggerModeSchema,
  filters: z.array(triggerFilterSchema).default([]),
  board: boardRefSchema.optional(),
});
export type TriggerConfig = z.infer<typeof triggerConfigSchema>;
