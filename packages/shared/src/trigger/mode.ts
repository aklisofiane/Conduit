import { z } from 'zod';

/**
 * How a trigger activates the workflow.
 *
 * - `webhook` — platform pushes events to `POST /api/hooks/:workflowId`.
 * - `polling` — Conduit polls the platform API every `intervalSec` seconds,
 *   diffing results against the last `PollSnapshot` for dedup.
 *
 * `scope` and `source` together pick *what* to watch and *where* to query:
 *
 *   - `scope: 'issues'`        + `source: 'board'` (default) → Projects v2 board (`TriggerConfig.board`)
 *   - `scope: 'issues'`        + `source: 'repo'`            → `repository.issues(states: OPEN)` on the connection's repo
 *   - `scope: 'pull_requests'` (source ignored)              → `repository.pullRequests(states: OPEN)` on the connection's repo
 *
 * PR scope is always repo-sourced; the field is allowed but the activity
 * doesn't read it for PRs. Defaults are chosen so triggers persisted before
 * either field existed round-trip to the prior board-issue behavior.
 */
export const triggerModeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('webhook'),
    event: z.string().min(1),
  }),
  z.object({
    kind: z.literal('polling'),
    intervalSec: z.number().int().positive(),
    scope: z.enum(['issues', 'pull_requests']).default('issues'),
    source: z.enum(['board', 'repo']).default('board'),
  }),
]);
export type TriggerMode = z.infer<typeof triggerModeSchema>;
