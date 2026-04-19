/**
 * Derive a stable branch-name slug from a ticket title. Called exactly once
 * per ticket — the result is cached on the `TicketBranch` row so the branch
 * name is stable even if the ticket title is edited later.
 *
 * Keeps only `[a-z0-9-]`; collapses repeat dashes; trims leading/trailing
 * dashes; truncates to a bounded length so the final ref stays well under
 * git's ref-length limits regardless of ticket id length.
 */
export function deriveSlug(title: string, maxLength = 40): string {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!normalized) return 'ticket';
  return normalized.slice(0, maxLength).replace(/-+$/, '') || 'ticket';
}

/** Format: `conduit/<ticketId>-<slug>`. See docs/design-docs/branch-management.md. */
export function formatBranchName(ticketId: string, slug: string): string {
  return `conduit/${ticketId}-${slug}`;
}
