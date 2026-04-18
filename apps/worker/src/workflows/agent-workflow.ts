import { proxyActivities } from '@temporalio/workflow';
import type { NodeOutput, TriggerEvent } from '@conduit/shared';
import type * as activities from '../activities/index';
import { topoSortGroups } from './topo-sort';

const {
  loadGraphActivity,
  runAgentNode,
  cleanupRunActivity,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 minutes',
  heartbeatTimeout: '60s',
  retry: {
    initialInterval: '2s',
    backoffCoefficient: 2,
    maximumInterval: '60s',
    maximumAttempts: 3,
    nonRetryableErrorTypes: [
      'ValidationError',
      'ConstraintExceededError',
      'UnauthorizedError',
    ],
  },
});

export interface AgentWorkflowInput {
  workflowId: string;
  runId: string;
  triggerEvent: TriggerEvent;
}

/**
 * Phase 1 workflow: single-group, sequential execution. Parallel fan-out
 * + merge-back + `.conduit/` copy land in Phase 3. The topo-sort helper is
 * wired in now so callers never change — only the per-group body does.
 */
export async function agentWorkflow(input: AgentWorkflowInput): Promise<void> {
  const { workflowId, runId, triggerEvent } = input;
  let error: string | undefined;
  try {
    const graph = await loadGraphActivity(workflowId);
    const groups = topoSortGroups(graph.nodes, graph.edges);

    // Workspace handoff for inherited workspaces — maps upstream node name
    // to its resolved workspace path. Phase 1: sequential only.
    const workspacePaths = new Map<string, string>();

    for (const group of groups) {
      const outputs = await Promise.all(
        group.map(async (node): Promise<[string, NodeOutput]> => {
          const upstreamWorkspacePath =
            node.workspace.kind === 'inherit'
              ? workspacePaths.get(node.workspace.fromNode)
              : undefined;

          const output = await runAgentNode({
            workflowId: graph.workflowId,
            workflowName: graph.workflowName,
            runId,
            node,
            mcpServers: graph.mcpServers,
            triggerEvent,
            upstreamWorkspacePath,
          });
          return [node.name, output];
        }),
      );
      for (const [name, output] of outputs) {
        workspacePaths.set(name, output.workspacePath);
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    await cleanupRunActivity({
      runId,
      status: error ? 'FAILED' : 'COMPLETED',
      error,
    });
  }
}
