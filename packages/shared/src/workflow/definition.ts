import { z } from 'zod';
import { agentConfigSchema } from '../agent/index';
import { triggerConfigSchema } from '../trigger/index';
import { workflowMcpServerSchema } from '../mcp/index';
import { edgeSchema } from './edge';
import { canvasUiSchema } from './canvas';

/**
 * Full workflow definition stored in `Workflow.definition` (JSON column).
 * Structural shape only — referential checks (topology, acyclicity,
 * workspace inheritance, `ticket-branch` compatibility) live in the
 * workflow validator and run at save time. See docs/design-docs/node-system.md.
 */
export const workflowDefinitionSchema = z
  .object({
    triggers: z.array(triggerConfigSchema),
    nodes: z.array(agentConfigSchema),
    edges: z.array(edgeSchema),
    mcpServers: z.array(workflowMcpServerSchema),
    ui: canvasUiSchema,
  })
  .superRefine((def, ctx) => {
    if (def.triggers.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['triggers'],
        message: 'A workflow must have exactly one trigger',
      });
    }

    const triggerNames = new Set(def.triggers.map((t) => t.name));
    const agentNames = new Set(def.nodes.map((n) => n.name));

    for (const name of triggerNames) {
      if (agentNames.has(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nodes'],
          message: `Name "${name}" is used by both a trigger and an agent`,
        });
      }
    }

    for (const [i, edge] of def.edges.entries()) {
      if (!triggerNames.has(edge.from) && !agentNames.has(edge.from)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['edges', i, 'from'],
          message: `Edge.from "${edge.from}" does not reference a known trigger or agent`,
        });
      }
      if (!agentNames.has(edge.to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['edges', i, 'to'],
          message: `Edge.to "${edge.to}" must reference an agent (triggers cannot be edge destinations)`,
        });
      }
    }
  });
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
