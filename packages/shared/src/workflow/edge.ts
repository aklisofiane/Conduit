import { z } from 'zod';
import { nodeNameSchema } from '../agent/node-name';

/**
 * Edges declare execution order only — they carry no config and no condition.
 * Branching lives inside agents (an agent can decide to do nothing).
 * Multiple edges into the same node = that node waits for all of them.
 */
export const edgeSchema = z.object({
  from: nodeNameSchema,
  to: nodeNameSchema,
});
export type Edge = z.infer<typeof edgeSchema>;
