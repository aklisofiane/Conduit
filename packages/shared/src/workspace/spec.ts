import { z } from 'zod';

/**
 * How a node's workspace is provisioned. Every agent runs against a workspace.
 *
 * - `fresh-tmpdir`   — empty sandbox. Rare; used for non-repo agents.
 * - `repo-clone`     — seeded from the base clone of a connected repo, ephemeral per-run.
 * - `inherit`        — reuse upstream agent's workspace (sequential) or branched worktree (parallel).
 * - `ticket-branch`  — persistent `conduit/<ticket-id>-<slug>` branch across runs on the same ticket.
 */
export const workspaceSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fresh-tmpdir') }),
  z.object({
    kind: z.literal('repo-clone'),
    connectionId: z.string().min(1),
    ref: z.string().optional(),
  }),
  z.object({
    kind: z.literal('inherit'),
    fromNode: z.string().min(1),
  }),
  z.object({
    kind: z.literal('ticket-branch'),
    connectionId: z.string().min(1),
    baseRef: z.string().optional(),
  }),
]);
export type WorkspaceSpec = z.infer<typeof workspaceSpecSchema>;
