import type { Edge } from '@conduit/shared';

/**
 * Tiny Kahn's-algorithm topological sort that groups independent nodes
 * into parallel buckets. Inlined into the workflow scope because Temporal's
 * V8 sandbox forbids Node-specific imports — so this can't pull in e.g.
 * `graphlib`. Pure-data type imports from `@conduit/shared` are fine.
 *
 * `entryNames` are the agents directly reachable from a trigger (i.e. agents
 * referenced by an edge whose `from` is a trigger name). Agents that are
 * not transitively reachable from any entry are skipped — this is what
 * makes "orphan" agents on the canvas not execute.
 */
export interface GraphNode {
  name: string;
}

export function topoSortGroups<T extends GraphNode>(
  nodes: T[],
  edges: Edge[],
  entryNames: string[],
): T[][] {
  if (nodes.length === 0) return [];
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const indegree = new Map<string, number>(nodes.map((n) => [n.name, 0]));
  const adjacency = new Map<string, string[]>(nodes.map((n) => [n.name, []]));
  for (const edge of edges) {
    if (!byName.has(edge.from) || !byName.has(edge.to)) continue;
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    adjacency.get(edge.from)!.push(edge.to);
  }

  // Reachability filter: only schedule agents that are descendants of an
  // entry. Indegree must be re-counted within the reachable subgraph so
  // Kahn's "ready" check stays correct after orphans are dropped.
  const reachable = new Set<string>();
  {
    const stack = entryNames.filter((n) => byName.has(n));
    while (stack.length > 0) {
      const name = stack.pop()!;
      if (reachable.has(name)) continue;
      reachable.add(name);
      for (const next of adjacency.get(name) ?? []) {
        if (!reachable.has(next)) stack.push(next);
      }
    }
  }
  const reachableIndegree = new Map<string, number>();
  for (const name of reachable) reachableIndegree.set(name, 0);
  for (const edge of edges) {
    if (!reachable.has(edge.from) || !reachable.has(edge.to)) continue;
    reachableIndegree.set(edge.to, (reachableIndegree.get(edge.to) ?? 0) + 1);
  }

  const groups: T[][] = [];
  let ready = nodes.filter(
    (n) => reachable.has(n.name) && (reachableIndegree.get(n.name) ?? 0) === 0,
  );
  const visited = new Set<string>();
  while (ready.length > 0) {
    groups.push(ready);
    const next: T[] = [];
    for (const node of ready) {
      visited.add(node.name);
      for (const neighbor of adjacency.get(node.name) ?? []) {
        if (!reachable.has(neighbor)) continue;
        const d = (reachableIndegree.get(neighbor) ?? 0) - 1;
        reachableIndegree.set(neighbor, d);
        if (d === 0 && !visited.has(neighbor)) {
          const m = byName.get(neighbor);
          if (m) next.push(m);
        }
      }
    }
    ready = next;
  }
  if (visited.size !== reachable.size) {
    throw new Error('Workflow graph contains a cycle');
  }
  return groups;
}
