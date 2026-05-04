import { z } from 'zod';
import { workflowDefinitionSchema } from '@conduit/shared';

/**
 * Accepts partial definitions so the UI can save drafts without a
 * fully-wired trigger. Deep validation (cycles, name uniqueness, workspace
 * inheritance) is layered on top at run time.
 */
export const createWorkflowDtoSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().optional(),
  definition: workflowDefinitionSchema.optional(),
});
export type CreateWorkflowDto = z.infer<typeof createWorkflowDtoSchema>;

export const updateWorkflowDtoSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().optional(),
  definition: workflowDefinitionSchema.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateWorkflowDto = z.infer<typeof updateWorkflowDtoSchema>;
