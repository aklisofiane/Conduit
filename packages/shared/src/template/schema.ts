import { z } from 'zod';
import { workflowDefinitionSchema } from '../workflow/definition';
import { agentConfigSchema } from '../agent/index';
import { agentProviderIdSchema } from '../agent/provider';
import { workflowMcpServerSchema } from '../mcp/server';

const kebabIdSchema = (label: string) =>
  z.string().regex(/^[a-z][a-z0-9-]*$/, `${label} must be kebab-case`);

/**
 * One workflow inside a template bundle. `definition` is the same shape as
 * `Workflow.definition` in the DB, with one exception: `connectionId` and
 * `boardConnectionId` fields may carry `<alias>` placeholders that the
 * `from-template` endpoint resolves into real Connection ids before
 * persisting. The Zod layer only enforces structure; per-slot scope-kind
 * validation runs in `collectTemplatePlaceholderDetails` + the API layer.
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

export const templateFileSchema = z.object({
  id: kebabIdSchema('template id'),
  name: z.string().min(1),
  description: z.string().min(1),
  category: templateCategorySchema,
  workflows: z.array(templateWorkflowSchema).min(1),
});
export type TemplateFile = z.infer<typeof templateFileSchema>;

/**
 * On-disk template agent shape: either `presetId` is set (instructions,
 * model, and provider come from the preset, optionally extended via
 * `instructionsAppend`), or the three concrete fields are inlined. The
 * loader expands presetId references into the runtime `agentConfigSchema`
 * shape before caching, so consumers of the cached `TemplateFile` never
 * see preset references.
 */
export const templateAgentInputSchema = agentConfigSchema
  .extend({
    presetId: kebabIdSchema('presetId').optional(),
    instructionsAppend: z.string().optional(),
    provider: agentProviderIdSchema.optional(),
    model: z.string().min(1).optional(),
    instructions: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.presetId) return;
    if (v.instructionsAppend !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['instructionsAppend'],
        message: 'instructionsAppend requires presetId',
      });
    }
    if (!v.provider) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['provider'],
        message: 'agent without presetId must specify provider',
      });
    }
    if (!v.model) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['model'],
        message: 'agent without presetId must specify model',
      });
    }
    if (v.instructions === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['instructions'],
        message: 'agent without presetId must specify instructions',
      });
    }
  });
export type TemplateAgentInput = z.infer<typeof templateAgentInputSchema>;

/**
 * On-disk MCP server shape: either `presetId` references an entry in
 * `MCP_PRESETS` (transport + name come from the preset), or `transport` is
 * inlined for one-off servers without a corresponding preset. Loader
 * expansion turns either into the runtime `workflowMcpServerSchema` shape
 * before caching, so consumers of `TemplateFile` never see preset
 * references.
 */
export const templateMcpServerInputSchema = workflowMcpServerSchema
  .partial({ name: true, transport: true })
  .extend({
    presetId: kebabIdSchema('presetId').optional(),
  })
  .superRefine((v, ctx) => {
    if (v.presetId) return;
    if (!v.transport) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['transport'],
        message: 'mcp server without presetId must specify transport',
      });
    }
    if (!v.name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message: 'mcp server without presetId must specify name',
      });
    }
  });
export type TemplateMcpServerInput = z.infer<typeof templateMcpServerInputSchema>;

export const templateInputWorkflowDefinitionSchema = workflowDefinitionSchema
  .innerType()
  .omit({ nodes: true, mcpServers: true })
  .extend({
    nodes: z.array(templateAgentInputSchema),
    mcpServers: z.array(templateMcpServerInputSchema),
  });
export type TemplateInputWorkflowDefinition = z.infer<
  typeof templateInputWorkflowDefinitionSchema
>;

export const templateInputWorkflowSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  definition: templateInputWorkflowDefinitionSchema,
});
export type TemplateInputWorkflow = z.infer<typeof templateInputWorkflowSchema>;

export const templateInputFileSchema = z.object({
  id: kebabIdSchema('template id'),
  name: z.string().min(1),
  description: z.string().min(1),
  category: templateCategorySchema,
  workflows: z.array(templateInputWorkflowSchema).min(1),
});
export type TemplateInputFile = z.infer<typeof templateInputFileSchema>;

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
