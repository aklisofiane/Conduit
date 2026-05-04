import type { Edge } from '@conduit/shared';

/**
 * Kahn's-algorithm topological sort that groups independent nodes into
 * parallel buckets. `entryNames` are the graph roots (typically agents
 * directly downstream of a trigger); nodes not transitively reachable
 * from any entry are skipped — that is what makes orphan agents on the
 * canvas not execute.
 *
 * Inlined into the workflow scope: Temporal's V8 sandbox forbids Node
 * imports, so this can't pull in `graphlib`. Type-only imports are fine.
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
  const adjacency = new Map<string, string[]>(nodes.map((n) => [n.name, []]));
  for (const edge of edges) {
    if (!byName.has(edge.from) || !byName.has(edge.to)) continue;
    adjacency.get(edge.from)!.push(edge.to);
  }

  // BFS from entries; tally indegree within the reachable subgraph as we go.
  // `indegree.has(name)` doubles as "reachable" — no separate Set needed.
  const indegree = new Map<string, number>();
  const stack: string[] = [];
  for (const name of entryNames) {
    if (!byName.has(name) || indegree.has(name)) continue;
    indegree.set(name, 0);
    stack.push(name);
  }
  while (stack.length > 0) {
    const name = stack.pop()!;
    for (const next of adjacency.get(name) ?? []) {
      if (indegree.has(next)) {
        indegree.set(next, indegree.get(next)! + 1);
      } else {
        indegree.set(next, 1);
        stack.push(next);
      }
    }
  }

  const groups: T[][] = [];
  let ready = nodes.filter((n) => indegree.get(n.name) === 0);
  let scheduled = 0;
  while (ready.length > 0) {
    groups.push(ready);
    scheduled += ready.length;
    const next: T[] = [];
    for (const node of ready) {
      for (const neighbor of adjacency.get(node.name) ?? []) {
        const d = indegree.get(neighbor)! - 1;
        indegree.set(neighbor, d);
        if (d === 0) {
          const m = byName.get(neighbor);
          if (m) next.push(m);
        }
      }
    }
    ready = next;
  }
  if (scheduled !== indegree.size) {
    throw new Error('Workflow graph contains a cycle');
  }
  return groups;
}
