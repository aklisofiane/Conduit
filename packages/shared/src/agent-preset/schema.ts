import { z } from 'zod';
import { agentProviderIdSchema, agentConstraintsSchema } from '../agent/index';

/**
 * Single-agent preset shipped as markdown in `/agent-presets/`. Metadata
 * lives in YAML frontmatter; the prose `instructions` is the markdown body.
 * Picked from the canvas's agent config panel to prefill `instructions`,
 * `model`, and `provider` on a freshly-added agent. Workflow-scoped fields
 * (workspace, mcpServers, skills) intentionally absent — the user wires
 * those up per-workflow after applying the preset.
 */
export const agentPresetCategorySchema = z.enum([
  'research',
  'review',
  'implement',
  'qa',
  'publish',
]);
export type AgentPresetCategory = z.infer<typeof agentPresetCategorySchema>;

export const agentPresetFileSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/, 'preset id must be kebab-case'),
  name: z.string().min(1),
  description: z.string().min(1),
  category: agentPresetCategorySchema,
  provider: agentProviderIdSchema,
  model: z.string().min(1),
  instructions: z.string().min(1),
  suggestedConstraints: agentConstraintsSchema.optional(),
});
export type AgentPresetFile = z.infer<typeof agentPresetFileSchema>;

export const agentPresetSchema = agentPresetFileSchema;
export type AgentPreset = z.infer<typeof agentPresetSchema>;
