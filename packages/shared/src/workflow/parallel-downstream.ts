import type { Edge } from './edge';

/**
 * Direct downstream node names of `nodeName`, in edge-declaration order.
 * No transitive walk — only edges where `from === nodeName`. Used to detect
 * parallel fan-out: `length > 1` means the node's siblings will run
 * concurrently in branched worktrees, and the worker injects a small
 * "parallel downstream" block into the agent's system prompt so a planner-
 * style agent can dispatch responsibilities by sibling name.
 *
 * Pure JS — safe to call from the Temporal V8 workflow sandbox.
 */
export function directDownstreamOf(nodeName: string, edges: readonly Edge[]): string[] {
  const out: string[] = [];
  for (const e of edges) {
    if (e.from === nodeName) out.push(e.to);
  }
  return out;
}

/**
 * Direct downstream names *only when the node fans out* (>1 immediate
 * children). Returns an empty array otherwise so callers can pass it
 * through without a length check.
 */
export function parallelDownstreamOf(
  nodeName: string,
  edges: readonly Edge[],
): string[] {
  const direct = directDownstreamOf(nodeName, edges);
  return direct.length > 1 ? direct : [];
}
