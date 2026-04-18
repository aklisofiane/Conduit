import { z } from 'zod';

/**
 * Filter applied to incoming trigger events. Multiple filters on the same
 * trigger combine with AND.
 *
 * Operator semantics:
 * - `eq` / `neq` — `value` is a string, exact match (case-sensitive).
 * - `in`         — `value` is string[]; field must equal any entry.
 * - `contains`   — `value` is a string, substring match on field (case-sensitive).
 */
export const triggerFilterSchema = z.object({
  field: z.string().min(1),
  op: z.enum(['eq', 'neq', 'in', 'contains']),
  value: z.union([z.string(), z.array(z.string())]),
});
export type TriggerFilter = z.infer<typeof triggerFilterSchema>;
