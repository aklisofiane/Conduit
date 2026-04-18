import { z } from 'zod';
import { mcpServerRefSchema } from '../mcp/index';
import { skillRefSchema } from '../skill/index';
import { workspaceSpecSchema } from '../workspace/index';
import { nodeNameSchema } from './node-name';
import { agentProviderIdSchema } from './provider';
import { agentConstraintsSchema } from './constraints';

/**
 * Agent node — the canvas's second and only runtime node type (trigger is
 * stored separately on `WorkflowDefinition.trigger`).
 *
 * `id` is a stable internal identifier (React keys, edge bookkeeping across
 * renames). `name` is the user-editable identifier used everywhere else.
 * Renames rewrite all references in the definition atomically at save time.
 */
export const agentConfigSchema = z.object({
  id: z.string().min(1),
  name: nodeNameSchema,
  provider: agentProviderIdSchema,
  model: z.string().min(1),
  instructions: z.string(),
  mcpServers: z.array(mcpServerRefSchema).default([]),
  skills: z.array(skillRefSchema).default([]),
  workspace: workspaceSpecSchema,
  constraints: agentConstraintsSchema.optional(),
});
export type AgentConfig = z.infer<typeof agentConfigSchema>;
