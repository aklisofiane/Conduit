/**
 * Make an identifier safe to embed in a container name or pidfile path:
 * collapse anything outside `[a-zA-Z0-9_.-]` to a dash. Run ids and node
 * names are already constrained upstream (`nodeNameSchema`, generated run
 * ids), so this is defensive — it guarantees the composed
 * `conduit-runner-<run>-<node>` / `runner-<node>.pid` strings stay valid even
 * if those constraints ever loosen.
 */
export function sanitizeNameSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9_.-]/g, '-');
}
