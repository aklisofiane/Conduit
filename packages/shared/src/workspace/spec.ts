import { z } from 'zod';

/**
 * How a node's workspace is provisioned. The shape is graph-derived at save
 * time — see `deriveWorkspaces` — so the user never picks a kind on the
 * canvas. Three arms cover every case:
 *
 * - `ticket-branch`  — entry kind for issue/PR triggers; persistent
 *                      `conduit/<ticket-id>-<slug>` branch (issue trigger)
 *                      or directly-anchored `pr.headRef` (PR trigger).
 * - `fixed-branch`   — entry kind for cron triggers; the agent works
 *                      directly on the trigger's user-selected branch.
 *                      No per-ticket slug, no per-tick ephemeral branch in
 *                      v1 — pushes land on the same branch the user picked.
 * - `inherit`        — reuse the upstream agent's workspace (sequential) or
 *                      a branched worktree off the upstream HEAD (parallel).
 *                      `fromNode` is the most-recent common ancestor of the
 *                      node's immediate upstreams; for a single upstream it
 *                      simplifies to that upstream itself.
 */
export const workspaceSpecSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('inherit'),
    fromNode: z.string().min(1),
  }),
  z.object({ kind: z.literal('ticket-branch') }),
  z.object({
    kind: z.literal('fixed-branch'),
    branch: z.string().min(1),
  }),
]);
export type WorkspaceSpec = z.infer<typeof workspaceSpecSchema>;
