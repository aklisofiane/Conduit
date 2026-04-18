import type { Edge } from '@conduit/shared';

/**
 * Tiny Kahn's-algorithm topological sort that groups independent nodes
 * into parallel buckets. Inlined into the workflow scope because Temporal's
 * V8 sandbox forbids Node-specific imports — so this can't pull in e.g.
 * `graphlib`. Pure-data type imports from `@conduit/shared` are fine.
 */
export interface GraphNode {
  name: string;
}

export function topoSortGroups<T extends GraphNode>(nodes: T[], edges: Edge[]): T[][] {
  if (nodes.length === 0) return [];
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const indegree = new Map<string, number>(nodes.map((n) => [n.name, 0]));
  const adjacency = new Map<string, string[]>(nodes.map((n) => [n.name, []]));
  for (const edge of edges) {
    if (!byName.has(edge.from) || !byName.has(edge.to)) continue;
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    adjacency.get(edge.from)!.push(edge.to);
  }

  const groups: T[][] = [];
  let ready = nodes.filter((n) => (indegree.get(n.name) ?? 0) === 0);
  const visited = new Set<string>();
  while (ready.length > 0) {
    groups.push(ready);
    const next: T[] = [];
    for (const node of ready) {
      visited.add(node.name);
      for (const neighbor of adjacency.get(node.name) ?? []) {
        const d = (indegree.get(neighbor) ?? 0) - 1;
        indegree.set(neighbor, d);
        if (d === 0 && !visited.has(neighbor)) {
          const m = byName.get(neighbor);
          if (m) next.push(m);
        }
      }
    }
    ready = next;
  }
  if (visited.size !== nodes.length) {
    throw new Error('Workflow graph contains a cycle');
  }
  return groups;
}
