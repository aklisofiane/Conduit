import { proxyActivities } from '@temporalio/workflow';
import type { AgentConfig, NodeOutput, TriggerEvent } from '@conduit/shared';
import type * as activities from '../activities/index';
import { topoSortGroups } from './topo-sort';

const {
  loadGraphActivity,
  runAgentNode,
  cleanupRunActivity,
  mergeWorktreeActivity,
  copyConduitFilesActivity,
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
      'MergeConflictError',
    ],
  },
});

export interface AgentWorkflowInput {
  workflowId: string;
  runId: string;
  triggerEvent: TriggerEvent;
}

/**
 * Sequential, group-at-a-time execution.
 *
 *   for each topo-sort group:
 *     1. run every node in parallel. `inherit` siblings in a >1 group each
 *        get a branched worktree (workspace manager handles it).
 *     2. sequentially merge each branched worktree back into its upstream
 *        in `definition.nodes` order — deterministic across re-runs.
 *     3. copy `.conduit/<NodeName>.md` from each branched worktree into the
 *        upstream workspace so downstream nodes see all sibling summaries.
 *
 * V8 sandbox constraint: all I/O lives in activities; this file only does
 * graph arithmetic and Temporal call dispatch.
 */
export async function agentWorkflow(input: AgentWorkflowInput): Promise<void> {
  const { workflowId, runId, triggerEvent } = input;
  let error: string | undefined;
  try {
    const graph = await loadGraphActivity(workflowId);
    const groups = topoSortGroups(graph.nodes, graph.edges);
    const definitionOrder = new Map(graph.nodes.map((n, i) => [n.name, i]));
    const outputs = new Map<string, NodeOutput>();

    for (const group of groups) {
      const inheritFanOut = inheritSiblingsByUpstream(group);

      const groupOutputs = await Promise.all(
        group.map(async (node): Promise<[string, NodeOutput]> => {
          const upstreamName =
            node.workspace.kind === 'inherit' ? node.workspace.fromNode : undefined;
          const upstreamOutput = upstreamName ? outputs.get(upstreamName) : undefined;
          const parallelBranch =
            node.workspace.kind === 'inherit' &&
            !!upstreamName &&
            (inheritFanOut.get(upstreamName)?.length ?? 0) > 1;

          const output = await runAgentNode({
            workflowId: graph.workflowId,
            workflowName: graph.workflowName,
            runId,
            node,
            mcpServers: graph.mcpServers,
            triggerEvent,
            upstreamWorkspacePath: upstreamOutput?.workspacePath,
            upstreamHead: upstreamOutput?.head,
            parallelBranch,
          });
          return [node.name, output];
        }),
      );
      for (const [name, output] of groupOutputs) {
        outputs.set(name, output);
      }

      // Post-group merge-back: sequential, one activity at a time, in
      // definition-order so conflicts resolve deterministically across runs.
      for (const [upstreamName, siblings] of inheritFanOut.entries()) {
        if (siblings.length <= 1) continue;
        const upstreamOutput = outputs.get(upstreamName);
        if (!upstreamOutput) continue;
        const ordered = [...siblings].sort(
          (a, b) => (definitionOrder.get(a) ?? 0) - (definitionOrder.get(b) ?? 0),
        );
        const copySources: Array<{ nodeName: string; workspacePath: string }> = [];
        for (const siblingName of ordered) {
          const sibling = outputs.get(siblingName);
          if (!sibling?.isBranchedWorktree) continue;
          await mergeWorktreeActivity({
            runId,
            sourceWorkspacePath: sibling.workspacePath,
            targetWorkspacePath: upstreamOutput.workspacePath,
            sourceNodeName: siblingName,
            targetNodeName: upstreamName,
          });
          copySources.push({ nodeName: siblingName, workspacePath: sibling.workspacePath });
        }
        if (copySources.length > 0) {
          await copyConduitFilesActivity({
            runId,
            sources: copySources,
            targetWorkspacePath: upstreamOutput.workspacePath,
            targetNodeName: upstreamName,
          });
        }
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

/**
 * Group `inherit` nodes in the same topo-sort bucket by their `fromNode`.
 * A key with >1 values means that upstream is being fanned out — the
 * siblings need branched worktrees plus a merge-back pass.
 */
function inheritSiblingsByUpstream(group: AgentConfig[]): Map<string, string[]> {
  const byUpstream = new Map<string, string[]>();
  for (const node of group) {
    if (node.workspace.kind !== 'inherit') continue;
    const list = byUpstream.get(node.workspace.fromNode) ?? [];
    list.push(node.name);
    byUpstream.set(node.workspace.fromNode, list);
  }
  return byUpstream;
}
