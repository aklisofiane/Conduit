import { z } from 'zod';

/**
 * How a node's workspace is provisioned. The shape is graph-derived at save
 * time — see `deriveWorkspaces` — so the user never picks a kind on the
 * canvas. Two arms cover every case:
 *
 * - `ticket-branch`  — entry kind; persistent `conduit/<ticket-id>-<slug>`
 *                      branch (issue trigger) or directly-anchored
 *                      `pr.headRef` (PR trigger). The connection comes from
 *                      the workflow's trigger configuration.
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
]);
export type WorkspaceSpec = z.infer<typeof workspaceSpecSchema>;
