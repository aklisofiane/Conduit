import { z } from 'zod';

/**
 * Filter applied to incoming trigger events. Multiple filters on a trigger
 * combine with AND.
 *
 * - `status` — exact equality on the issue/PR's Status column (project board
 *   single-select).
 * - `label`  — membership: row matches if `value` is one of the issue's
 *   labels. To require multiple labels, add multiple label rows.
 *
 * Empty `value` is allowed at the schema level so in-progress UI rows can
 * round-trip; `applyFilter` safe-fails on it.
 */
export const triggerFilterSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('status'), value: z.string() }),
  z.object({ field: z.literal('label'), value: z.string() }),
]);
export type TriggerFilter = z.infer<typeof triggerFilterSchema>;
