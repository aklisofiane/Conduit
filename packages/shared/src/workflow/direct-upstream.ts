import type { Edge } from './edge';

/**
 * Direct upstream names — every immediate DAG-predecessor of `nodeName`, in
 * edge-declaration order. The mirror of `parallelDownstreamOf`, but with no
 * fan-in gate: a node with a single upstream still gets it, since the runtime
 * hands every sequencing node its predecessor's handoff summary.
 *
 * Pure JS — safe to call from the Temporal V8 workflow sandbox.
 */
export function directUpstreamOf(
  nodeName: string,
  edges: readonly Edge[],
): string[] {
  const out: string[] = [];
  for (const e of edges) {
    if (e.to === nodeName) out.push(e.from);
  }
  return out;
}
