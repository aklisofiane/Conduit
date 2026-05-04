import type {
  AgentConfig,
  Edge,
  TriggerConfig,
  WorkflowDefinition,
} from '@conduit/shared';
import { workflowDefinitionSchema } from '@conduit/shared';
import { prisma } from '../runtime/prisma';

export interface LoadedGraph {
  workflowId: string;
  workflowName: string;
  triggers: TriggerConfig[];
  nodes: AgentConfig[];
  edges: Edge[];
  mcpServers: WorkflowDefinition['mcpServers'];
}

/**
 * Read the workflow + its definition from Postgres, parse via Zod to catch
 * any drift between DB JSON and current schema, and return the plain
 * object the Temporal workflow uses for topo-sort.
 */
export async function loadGraphActivity(workflowId: string): Promise<LoadedGraph> {
  const wf = await prisma().workflow.findUnique({ where: { id: workflowId } });
  if (!wf) throw new Error(`Workflow ${workflowId} not found`);
  const parsed = workflowDefinitionSchema.parse(wf.definition);
  return {
    workflowId: wf.id,
    workflowName: wf.name,
    triggers: parsed.triggers,
    nodes: parsed.nodes,
    edges: parsed.edges,
    mcpServers: parsed.mcpServers,
  };
}
