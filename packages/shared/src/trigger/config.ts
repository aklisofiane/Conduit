import { z } from 'zod';
import { triggerSourceSchema } from '../platform/index';
import { triggerFilterSchema } from './filter';
import { triggerModeSchema } from './mode';

/** Persisted trigger shape on `WorkflowDefinition.trigger`. */
export const triggerConfigSchema = z.object({
  platform: triggerSourceSchema,
  connectionId: z.string().min(1),
  mode: triggerModeSchema,
  filters: z.array(triggerFilterSchema).default([]),
});
export type TriggerConfig = z.infer<typeof triggerConfigSchema>;
