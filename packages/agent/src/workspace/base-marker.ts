/**
 * Parse the optional `<!-- conduit:base=<branch> -->` marker out of a platform
 * issue body. The marker lets an issue carry a non-default base branch from the
 * run that created it (e.g. a cron on `branch-2`) to the later run that picks it
 * up — see `.specs/ticket-branch-base-marker.md`.
 *
 * Free text inside an HTML comment: branch names with `/` or `.`
 * (`release/2.0`) work verbatim, with no GitHub label namespace involved. The
 * marker lives inside the Conduit body block (`<!-- conduit:start/end -->`),
 * but parsing doesn't depend on that — it matches the marker anywhere.
 *
 * Pure, no I/O. The first marker wins; returns `undefined` when absent or empty.
 */
const BASE_MARKER = /<!--\s*conduit:base=([^\s>]+)\s*-->/;

export function parseBaseMarker(body?: string): string | undefined {
  if (!body) return undefined;
  // The capture group is `[^\s>]+`, so a match is always a non-empty,
  // whitespace-free branch name and the no-value `conduit:base=` case fails to
  // match outright — no trim/empty-check needed.
  return BASE_MARKER.exec(body)?.[1];
}
