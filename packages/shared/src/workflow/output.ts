import { z } from 'zod';

/**
 * Lightweight per-node output. The agent's prose summary for downstream
 * agents lives in `.conduit/<NodeName>.md` inside the workspace — not here.
 *
 * `head` / `workspaceKind` / `isBranchedWorktree` are populated for git-backed
 * workspaces so the workflow can drive parallel branching + merge-back
 * deterministically without re-reading the filesystem from the workflow
 * sandbox (which can't run git).
 */
export const nodeOutputSchema = z.object({
  files: z.array(z.string()).optional(),
  workspacePath: z.string().min(1),
  head: z.string().optional(),
  workspaceKind: z.enum(['fresh-tmpdir', 'repo-clone', 'inherit', 'ticket-branch']).optional(),
  isBranchedWorktree: z.boolean().optional(),
});
export type NodeOutput = z.infer<typeof nodeOutputSchema>;
