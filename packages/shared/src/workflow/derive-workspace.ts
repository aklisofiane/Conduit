import type { AgentConfig } from '../agent/index';
import type { Edge } from './edge';
import type { TriggerConfig } from '../trigger/index';
import type { WorkspaceSpec } from '../workspace/index';
import type { WorkflowDefinition } from './definition';

/**
 * A workflow definition where every node's workspace is populated. Returned
 * by `deriveWorkspaces` so downstream code (worker, identity helpers) can
 * iterate nodes without a non-null assertion on `node.workspace`.
 */
export type AgentConfigWithWorkspace = AgentConfig & {
  workspace: WorkspaceSpec;
};

export interface DerivedWorkflowDefinition extends WorkflowDefinition {
  nodes: AgentConfigWithWorkspace[];
}

/**
 * Compute each node's workspace from graph topology and return a copy of
 * the definition with `nodes[].workspace` populated. The user-authored
 * canvas only stores edges; everything in the runtime layer (worker,
 * identity, validation that needs to look at workspace shape) calls this
 * before iterating nodes.
 *
 * Rules:
 *   1. A node whose immediate upstreams include a trigger → `ticket-branch`.
 *   2. A node with a single agent upstream → `inherit { fromNode: that }`.
 *   3. A node with multiple agent upstreams → `inherit { fromNode: <lca> }`,
 *      where `<lca>` is the topo-latest common ancestor of those upstreams.
 *      For `develop.json`'s QA (depends on Dev/Tests/Docs, which all share
 *      Seed), this resolves to Seed — matching the runtime's parallel-merge
 *      semantics where sibling worktrees merge back into Seed before a
 *      downstream agent reads from it.
 *   4. An orphan agent (no upstream of any kind) → `ticket-branch`. These
 *      don't execute (topo-sort skips them) so the kind is incidental.
 *
 * If a node already has a workspace (legacy stored JSON predating this
 * derivation), it is preserved as-is. Pre-1.0 dev DBs are wiped before
 * deploy, so this only matters during the cutover.
 */
export function deriveWorkspaces(
  definition: WorkflowDefinition,
): DerivedWorkflowDefinition {
  const triggerNames = new Set(definition.triggers.map((t) => t.name));
  const nodeNames = new Set(definition.nodes.map((n) => n.name));
  const incoming = buildIncomingMap(definition.edges, nodeNames, triggerNames);
  const topoIndex = topoIndexMap(definition.nodes, definition.edges, nodeNames);

  const nodes: AgentConfigWithWorkspace[] = definition.nodes.map((node) => {
    if (node.workspace) return { ...node, workspace: node.workspace };
    return { ...node, workspace: deriveOne(node.name, incoming, topoIndex) };
  });

  return { ...definition, nodes };
}

interface NodeIncoming {
  fromTriggers: string[];
  fromAgents: string[];
}

function buildIncomingMap(
  edges: Edge[],
  agentNames: Set<string>,
  triggerNames: Set<string>,
): Map<string, NodeIncoming> {
  const map = new Map<string, NodeIncoming>();
  for (const name of agentNames) {
    map.set(name, { fromTriggers: [], fromAgents: [] });
  }
  for (const edge of edges) {
    const bucket = map.get(edge.to);
    if (!bucket) continue;
    if (triggerNames.has(edge.from)) {
      if (!bucket.fromTriggers.includes(edge.from)) bucket.fromTriggers.push(edge.from);
    } else if (agentNames.has(edge.from)) {
      if (!bucket.fromAgents.includes(edge.from)) bucket.fromAgents.push(edge.from);
    }
  }
  return map;
}

function deriveOne(
  nodeName: string,
  incoming: Map<string, NodeIncoming>,
  topoIndex: Map<string, number>,
): WorkspaceSpec {
  const inc = incoming.get(nodeName);
  if (!inc) return { kind: 'ticket-branch' };
  if (inc.fromTriggers.length > 0) return { kind: 'ticket-branch' };
  if (inc.fromAgents.length === 0) return { kind: 'ticket-branch' };
  if (inc.fromAgents.length === 1) {
    return { kind: 'inherit', fromNode: inc.fromAgents[0]! };
  }

  // Fan-in: intersect ancestor sets, pick topo-latest from the intersection.
  // Each upstream is a member of its own ancestor set so a direct shared
  // parent (Seed in develop.json) is captured.
  const ancestorSets = inc.fromAgents.map((agent) => {
    const set = collectAgentAncestors(agent, incoming);
    set.add(agent);
    return set;
  });
  let common: Set<string> = new Set(ancestorSets[0]);
  for (let i = 1; i < ancestorSets.length; i++) {
    common = new Set([...common].filter((x) => ancestorSets[i]!.has(x)));
  }
  if (common.size === 0) {
    // Disconnected upstreams (graph error — would also fail topo-sort).
    // Fall back to first upstream so derivation still produces a valid spec.
    return { kind: 'inherit', fromNode: inc.fromAgents[0]! };
  }
  let bestName = '';
  let bestIdx = -1;
  for (const name of common) {
    const idx = topoIndex.get(name) ?? -1;
    if (idx > bestIdx) {
      bestIdx = idx;
      bestName = name;
    }
  }
  return { kind: 'inherit', fromNode: bestName };
}

function collectAgentAncestors(
  start: string,
  incoming: Map<string, NodeIncoming>,
): Set<string> {
  const result = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const inc = incoming.get(cur);
    if (!inc) continue;
    for (const parent of inc.fromAgents) {
      if (result.has(parent)) continue;
      result.add(parent);
      stack.push(parent);
    }
  }
  return result;
}

/**
 * Kahn's-algorithm topo index for the agent subgraph (triggers excluded).
 * Used only to break ties when multiple common ancestors survive the
 * intersection — pick the one closest to the fan-in node. Cycles fall back
 * to definition order (we don't throw here; topoSortGroups in the worker
 * is the canonical cycle detector).
 */
function topoIndexMap(
  nodes: AgentConfig[],
  edges: Edge[],
  agentNames: Set<string>,
): Map<string, number> {
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const n of nodes) {
    indegree.set(n.name, 0);
    adjacency.set(n.name, []);
  }
  for (const edge of edges) {
    if (!agentNames.has(edge.from) || !agentNames.has(edge.to)) continue;
    adjacency.get(edge.from)!.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const [name, deg] of indegree) {
    if (deg === 0) queue.push(name);
  }
  const order = new Map<string, number>();
  let i = 0;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    order.set(cur, i++);
    for (const next of adjacency.get(cur) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  // Cycle nodes never enter the queue — give them a stable index from
  // definition order so the LCA tie-breaker stays deterministic.
  for (const n of nodes) {
    if (!order.has(n.name)) order.set(n.name, i++);
  }
  return order;
}
