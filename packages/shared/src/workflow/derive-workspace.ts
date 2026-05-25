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
 *   1. A node whose immediate upstreams include a cron trigger →
 *      `fixed-branch { branch }` using the cron trigger's `branch` field.
 *   2. A node whose immediate upstreams include an issue/PR trigger →
 *      `ticket-branch`.
 *   3. A node with a single agent upstream → `inherit { fromNode: that }`.
 *   4. A node with multiple agent upstreams → `inherit { fromNode: <lca> }`,
 *      where `<lca>` is the topo-latest common ancestor of those upstreams.
 *      For `develop.json`'s QA (depends on Dev/Tests/Docs, which all share
 *      Seed), this resolves to Seed — matching the runtime's parallel-merge
 *      semantics where sibling worktrees merge back into Seed before a
 *      downstream agent reads from it.
 *   5. An orphan agent (no upstream of any kind) → `ticket-branch`. These
 *      don't execute (topo-sort skips them) so the kind is incidental.
 *
 * If a node already has a workspace (legacy stored JSON predating this
 * derivation), it is preserved as-is. Pre-1.0 dev DBs are wiped before
 * deploy, so this only matters during the cutover.
 */
export function deriveWorkspaces(
  definition: WorkflowDefinition,
): DerivedWorkflowDefinition {
  const triggersByName = new Map(definition.triggers.map((t) => [t.name, t]));
  const nodeNames = new Set(definition.nodes.map((n) => n.name));
  const incoming = buildIncomingMap(definition.edges, nodeNames, triggersByName);
  const topoIndex = topoIndexMap(definition.nodes, definition.edges, nodeNames);

  const nodes: AgentConfigWithWorkspace[] = definition.nodes.map((node) => {
    if (node.workspace) return { ...node, workspace: node.workspace };
    return { ...node, workspace: deriveOne(node.name, incoming, topoIndex) };
  });

  return { ...definition, nodes };
}

interface NodeIncoming {
  fromTriggers: TriggerConfig[];
  fromAgents: Set<string>;
}

function buildIncomingMap(
  edges: Edge[],
  agentNames: Set<string>,
  triggersByName: Map<string, TriggerConfig>,
): Map<string, NodeIncoming> {
  const map = new Map<string, NodeIncoming>();
  for (const name of agentNames) {
    map.set(name, { fromTriggers: [], fromAgents: new Set() });
  }
  for (const edge of edges) {
    const bucket = map.get(edge.to);
    if (!bucket) continue;
    const trigger = triggersByName.get(edge.from);
    if (trigger) {
      bucket.fromTriggers.push(trigger);
    } else if (agentNames.has(edge.from)) {
      bucket.fromAgents.add(edge.from);
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
  if (inc.fromTriggers.length > 0) {
    // A cron upstream forces fixed-branch — even if a non-cron trigger also
    // feeds in, the validator rejects mixed kinds, so picking either is fine.
    const cron = inc.fromTriggers.find((t) => t.type === 'cron');
    if (cron && cron.type === 'cron') return { kind: 'fixed-branch', branch: cron.branch };
    return { kind: 'ticket-branch' };
  }
  if (inc.fromAgents.size === 0) return { kind: 'ticket-branch' };
  const agents = [...inc.fromAgents];
  if (agents.length === 1) {
    return { kind: 'inherit', fromNode: agents[0]! };
  }

  // Fan-in: intersect ancestor closures (each closure includes its own start),
  // then pick topo-latest from the intersection. A direct shared parent like
  // Seed in develop.json is captured because each upstream's closure contains
  // itself.
  const closures = agents.map((agent) => agentClosure(agent, incoming));
  let common: Set<string> = new Set(closures[0]);
  for (let i = 1; i < closures.length; i++) {
    common = new Set([...common].filter((x) => closures[i]!.has(x)));
  }
  if (common.size === 0) {
    // Disconnected upstreams (graph error — would also fail topo-sort).
    // Fall back to first upstream so derivation still produces a valid spec.
    return { kind: 'inherit', fromNode: agents[0]! };
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

/** Set of `start` plus all transitive agent ancestors. */
function agentClosure(
  start: string,
  incoming: Map<string, NodeIncoming>,
): Set<string> {
  const result = new Set<string>([start]);
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
  // Index pointer instead of queue.shift() — the latter is O(n) per call,
  // turning Kahn's into O(V²). We never re-read consumed slots.
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
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
