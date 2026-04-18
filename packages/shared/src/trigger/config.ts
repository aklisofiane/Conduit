import { z } from 'zod';
import { triggerSourceSchema } from '../platform/index.js';
import { triggerFilterSchema } from './filter.js';
import { triggerModeSchema } from './mode.js';

/** Persisted trigger shape on `WorkflowDefinition.trigger`. */
export const triggerConfigSchema = z.object({
  platform: triggerSourceSchema,
  connectionId: z.string().min(1),
  mode: triggerModeSchema,
  filters: z.array(triggerFilterSchema).default([]),
});
export type TriggerConfig = z.infer<typeof triggerConfigSchema>;
