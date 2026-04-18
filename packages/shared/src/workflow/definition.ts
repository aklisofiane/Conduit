import { z } from 'zod';
import { agentConfigSchema } from '../agent/index';
import { triggerConfigSchema } from '../trigger/index';
import { workflowMcpServerSchema } from '../mcp/index';
import { edgeSchema } from './edge';
import { canvasUiSchema } from './canvas';

/**
 * Full workflow definition stored in `Workflow.definition` (JSON column).
 *
 * Structural shape only — deeper referential checks (topology, acyclicity,
 * workspace inheritance rules, `ticket-branch` trigger compatibility) live
 * in the workflow validator and run at save time. See validation rules in
 * docs/design-docs/node-system.md.
 */
export const workflowDefinitionSchema = z.object({
  trigger: triggerConfigSchema,
  nodes: z.array(agentConfigSchema),
  edges: z.array(edgeSchema),
  mcpServers: z.array(workflowMcpServerSchema),
  ui: canvasUiSchema,
});
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
