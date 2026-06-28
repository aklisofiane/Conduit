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
    // Zero triggers is a legal in-flight state during the swap-by-delete UX
    // — the API gate (workflows.service.assertActivatable) prevents an
    // empty workflow from being activated, so the runtime never sees one.
    if (def.triggers.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['triggers'],
        message: 'A workflow can have at most one trigger',
      });
    }

    const triggerNames = new Set(def.triggers.map((t) => t.name));
    const agentNames = new Set(def.nodes.map((n) => n.name));

    // Node ids and names must each be unique. Edges and the runtime key off
    // both, so a duplicate silently corrupts the graph (ambiguous edge
    // endpoints, a node keyed by a colliding id) rather than failing loudly.
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    for (const node of def.nodes) {
      if (seenIds.has(node.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nodes'],
          message: `Duplicate node id "${node.id}"`,
        });
      }
      seenIds.add(node.id);
      if (seenNames.has(node.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nodes'],
          message: `Duplicate node name "${node.name}"`,
        });
      }
      seenNames.add(node.name);
    }

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
