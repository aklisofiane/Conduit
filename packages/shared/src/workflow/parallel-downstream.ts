import type { Edge } from './edge';

/**
 * Direct downstream names *only when the node fans out* (>1 immediate
 * children), in edge-declaration order. Returns an empty array otherwise so
 * callers can pass it through without a length check.
 *
 * Pure JS — safe to call from the Temporal V8 workflow sandbox.
 */
export function parallelDownstreamOf(
  nodeName: string,
  edges: readonly Edge[],
): string[] {
  const out: string[] = [];
  for (const e of edges) {
    if (e.from === nodeName) out.push(e.to);
  }
  return out.length > 1 ? out : [];
}
