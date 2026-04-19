import { z } from 'zod';
import { workflowDefinitionSchema } from '../workflow/definition';

/**
 * One workflow inside a template bundle. `definition` is the same shape as
 * `Workflow.definition` in the DB, with one exception: `connectionId` fields
 * may carry `<alias>` placeholders that the `from-template` endpoint resolves
 * before persisting. Validation of those placeholders happens in
 * `collectTemplatePlaceholders` — the Zod layer only enforces structure.
 */
export const templateWorkflowSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  definition: workflowDefinitionSchema,
});
export type TemplateWorkflow = z.infer<typeof templateWorkflowSchema>;

export const templateCategorySchema = z.enum([
  'triage',
  'develop',
  'review',
  'board-loop',
]);
export type TemplateCategory = z.infer<typeof templateCategorySchema>;

/** Shape of `/templates/*.json` files. */
export const templateFileSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/, 'template id must be kebab-case'),
  name: z.string().min(1),
  description: z.string().min(1),
  category: templateCategorySchema,
  workflows: z.array(templateWorkflowSchema).min(1),
});
export type TemplateFile = z.infer<typeof templateFileSchema>;

/** Shape returned by `GET /api/templates` — summary only, no definitions. */
export const templateSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: templateCategorySchema,
  workflowCount: z.number().int().positive(),
  /** Unique connection placeholders across all workflows in the bundle. */
  placeholders: z.array(z.string()),
});
export type TemplateSummary = z.infer<typeof templateSummarySchema>;
