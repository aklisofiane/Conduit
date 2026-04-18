import { z } from 'zod';

/**
 * Lightweight per-node output. The agent's prose summary for downstream
 * agents lives in `.conduit/<NodeName>.md` inside the workspace — not here.
 */
export const nodeOutputSchema = z.object({
  files: z.array(z.string()).optional(),
  workspacePath: z.string().min(1),
});
export type NodeOutput = z.infer<typeof nodeOutputSchema>;
