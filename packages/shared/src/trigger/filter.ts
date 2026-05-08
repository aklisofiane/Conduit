import { z } from 'zod';

/**
 * Filter applied to incoming trigger events. Multiple filters on a trigger
 * combine with AND.
 *
 * - `status`   — exact equality on the issue/PR's Status column (project
 *   board single-select). Issue-shaped polling and webhook events.
 * - `label`    — membership: row matches if `value` is one of the issue's
 *   labels. To require multiple labels, add multiple label rows.
 * - `pr_state` — for polling triggers with `mode.scope === 'pull_requests'`.
 *   `'draft'` / `'ready_for_review'` match the PR's draft state; `'any'` is
 *   an explicit always-match so the UI can show a selected value without an
 *   empty-row safe-fail.
 *
 * Empty `value` is allowed at the schema level for `status`/`label` so
 * in-progress UI rows can round-trip; `applyFilter` safe-fails on it.
 */
export const triggerFilterSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('status'), value: z.string() }),
  z.object({ field: z.literal('label'), value: z.string() }),
  z.object({
    field: z.literal('pr_state'),
    value: z.enum(['draft', 'ready_for_review', 'any']),
  }),
]);
export type TriggerFilter = z.infer<typeof triggerFilterSchema>;
