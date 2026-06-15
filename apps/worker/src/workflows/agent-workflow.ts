import { proxyActivities } from '@temporalio/workflow';
import type {
  AgentConfigWithWorkspace,
  NodeOutput,
  TriggerEvent,
} from '@conduit/shared';
import { directUpstreamOf, parallelDownstreamOf } from '@conduit/shared';
import type * as activities from '../activities/index';
import { topoSortGroups } from './topo-sort';

// Agent sessions aren't resumable mid-conversation (see run-agent-node.ts header).
// On timeout/failure, fail the run rather than retry from scratch and waste tokens.
const { runAgentNode } = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 hours',
  // Temporal throttles heartbeat flushes to min(0.8 × heartbeatTimeout, 60s),
  // so the 30s in-activity timer only buys margin if the flush window has slack.
  // At 60s that effective margin is ~12s — thin enough that a burst of large
  // event-payload parsing on the worker loop can miss the deadline and fail a
  // live run. 120s lifts the throttle to its 60s cap (~60s of real margin); the
  // only cost is noticing a truly dead worker ~60s later, which is free under
  // maxAttempts: 1 (the 2h start-to-close still bounds a genuine hang).
  heartbeatTimeout: '120s',
  retry: {
    maximumAttempts: 1,
  },
});

const {
  loadGraphActivity,
  cleanupRunActivity,
  mergeWorktreeActivity,
  copyConduitFilesActivity,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
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
    const triggerNames = new Set(graph.triggers.map((t) => t.name));
    const entryNames: string[] = [];
    const agentEdges: typeof graph.edges = [];
    for (const edge of graph.edges) {
      if (triggerNames.has(edge.from)) entryNames.push(edge.to);
      else agentEdges.push(edge);
    }
    const groups = topoSortGroups(graph.nodes, agentEdges, entryNames);
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
            orgId: graph.orgId,
            runId,
            node,
            mcpServers: graph.mcpServers,
            triggers: graph.triggers,
            triggerEvent,
            upstreamWorkspacePath: upstreamOutput?.workspacePath,
            upstreamHead: upstreamOutput?.head,
            parallelBranch,
            parallelDownstream: parallelDownstreamOf(node.name, agentEdges),
            directUpstream: directUpstreamOf(node.name, agentEdges),
          });
          return [node.name, output];
        }),
      );
      for (const [name, output] of groupOutputs) {
        outputs.set(name, output);
      }

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
            orgId: graph.orgId,
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
            orgId: graph.orgId,
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
function inheritSiblingsByUpstream(
  group: AgentConfigWithWorkspace[],
): Map<string, string[]> {
  const byUpstream = new Map<string, string[]>();
  for (const node of group) {
    if (node.workspace.kind !== 'inherit') continue;
    const list = byUpstream.get(node.workspace.fromNode) ?? [];
    list.push(node.name);
    byUpstream.set(node.workspace.fromNode, list);
  }
  return byUpstream;
}
