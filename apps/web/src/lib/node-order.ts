import type { WorkflowDefinition } from '@conduit/shared';

/**
 * Rank node names by execution order so the run rail follows the workflow
 * graph (scope first, publish last) instead of alphabetical name order.
 *
 * A stable topological sort over the agent nodes: edges from triggers seed the
 * roots, and ties between ready/parallel nodes break by their position in
 * `definition.nodes` so the rail mirrors the canvas. Names absent from the
 * definition (or stranded in a cycle) sort last, keeping the function total.
 */
export function workflowNodeRank(definition: WorkflowDefinition | undefined): Map<string, number> {
  const rank = new Map<string, number>();
  if (!definition) return rank;

  const order = new Map<string, number>(definition.nodes.map((n, i) => [n.name, i]));
  const agents = new Set(order.keys());

  const successors = new Map<string, string[]>();
  const indegree = new Map<string, number>(definition.nodes.map((n) => [n.name, 0]));
  for (const edge of definition.edges) {
    // Trigger → agent edges seed roots; only agent → agent edges add ordering
    // constraints between nodes that actually run.
    if (!agents.has(edge.from) || !agents.has(edge.to)) continue;
    (successors.get(edge.from) ?? successors.set(edge.from, []).get(edge.from)!).push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  // Ready set processed in definition order so parallel branches keep their
  // canvas ordering rather than drifting by name.
  const byDefinitionOrder = (a: string, b: string) => (order.get(a) ?? 0) - (order.get(b) ?? 0);
  const ready = definition.nodes
    .filter((n) => (indegree.get(n.name) ?? 0) === 0)
    .map((n) => n.name);

  let next = 0;
  while (ready.length > 0) {
    ready.sort(byDefinitionOrder);
    const name = ready.shift()!;
    if (rank.has(name)) continue;
    rank.set(name, next++);
    for (const to of successors.get(name) ?? []) {
      indegree.set(to, (indegree.get(to) ?? 0) - 1);
      if ((indegree.get(to) ?? 0) === 0) ready.push(to);
    }
  }

  // Any node left unranked (a cycle the validator normally rejects) falls back
  // to definition order after the topologically sorted ones.
  for (const node of definition.nodes) {
    if (!rank.has(node.name)) rank.set(node.name, next++);
  }

  return rank;
}
