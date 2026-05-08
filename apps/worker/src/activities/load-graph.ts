import type {
  AgentConfigWithWorkspace,
  Edge,
  TriggerConfig,
  WorkflowDefinition,
} from '@conduit/shared';
import { deriveWorkspaces, workflowDefinitionSchema } from '@conduit/shared';
import { prisma } from '../runtime/prisma';

export interface LoadedGraph {
  workflowId: string;
  workflowName: string;
  /** Tenant scope — copied onto every derived row (NodeRun, ExecutionLog) the
   *  workflow's activities subsequently write. */
  orgId: string;
  triggers: TriggerConfig[];
  /** Workspaces are derived from edges before the workflow sees the graph. */
  nodes: AgentConfigWithWorkspace[];
  edges: Edge[];
  mcpServers: WorkflowDefinition['mcpServers'];
}

/**
 * Read the workflow + its definition from Postgres, parse via Zod to catch
 * any drift between DB JSON and current schema, derive each node's
 * workspace from graph topology, and return the plain object the Temporal
 * workflow uses for topo-sort.
 */
export async function loadGraphActivity(workflowId: string): Promise<LoadedGraph> {
  const wf = await prisma().workflow.findUnique({ where: { id: workflowId } });
  if (!wf) throw new Error(`Workflow ${workflowId} not found`);
  const parsed = workflowDefinitionSchema.parse(wf.definition);
  const derived = deriveWorkspaces(parsed);
  return {
    workflowId: wf.id,
    workflowName: wf.name,
    orgId: wf.orgId,
    triggers: derived.triggers,
    nodes: derived.nodes,
    edges: derived.edges,
    mcpServers: derived.mcpServers,
  };
}
