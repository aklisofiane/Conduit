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

/**
 * Manual run payload. Any of `issue`/`repo` can be passed to synthesize a
 * trigger event when running against a specific issue/PR.
 */
export const manualRunDtoSchema = z.object({
  issue: z
    .object({
      id: z.string().min(1),
      key: z.string().min(1),
      title: z.string(),
      url: z.string().url(),
    })
    .optional(),
  repo: z
    .object({
      owner: z.string().min(1),
      name: z.string().min(1),
    })
    .optional(),
  actor: z.string().optional(),
});
export type ManualRunDto = z.infer<typeof manualRunDtoSchema>;
