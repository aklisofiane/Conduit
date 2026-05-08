import { z } from 'zod';

/**
 * Filter applied to incoming trigger events. Multiple filters on a trigger
 * combine with AND.
 *
 * Two kinds, both single-valued:
 * - `status` — exact equality on the issue/PR's Status column (project board
 *   single-select).
 * - `label`  — membership: row matches if `value` is one of the issue's
 *   labels. To require multiple labels, add multiple label rows (AND).
 */
export const triggerFilterSchema = z.discriminatedUnion('field', [
  z.object({
    field: z.literal('status'),
    // Empty string is allowed for in-progress UI rows; the matcher
    // safe-fails because no real Status column ever equals ''.
    value: z.string(),
  }),
  z.object({
    field: z.literal('label'),
    // Empty string is allowed for in-progress UI rows; matcher safe-fails.
    value: z.string(),
  }),
]);
export type TriggerFilter = z.infer<typeof triggerFilterSchema>;
