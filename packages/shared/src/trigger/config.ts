import { z } from 'zod';
import { nodeNameSchema } from '../agent/node-name';
import { triggerSourceSchema } from '../platform/index';
import type { GithubProjectsV2Scope } from '../connection/scope';

/**
 * Persisted trigger shape on `WorkflowDefinition.triggers[]`. `name` shares
 * a namespace with agent names so `Edge.from` can reference either.
 *
 * The top-level `type` discriminator picks *what the user is watching*:
 *
 *   - `issues`        — polling-delivered. Optional `boardConnectionId`
 *     unlocks board-aware behavior (status filter, column-change semantics).
 *   - `pull_requests` — polling-delivered, repo-sourced. Supports `pr_state`
 *     filters; `boardConnectionId` is ignored.
 *   - `webhook`       — platform-pushed. Carries an `event` name; preserved
 *     for the dormant webhooks surface and any legacy data. Not exposed in
 *     the UI today.
 *
 * Connections are referenced by ID through two named slots:
 *
 *   - `connectionId`      — the source binding (today: a `github_repo`
 *     Connection on the workflow). Required.
 *   - `boardConnectionId` — present when board behavior is desired
 *     (`type: 'issues'`) or required (`type: 'webhook'` with
 *     `event: 'board.column.changed'`). Connection scope is checked against
 *     the slot's role at the API boundary; the validator only sees IDs.
 *
 * Filter validity is enforced per variant: `issues` accepts `label` /
 * `status`; `pull_requests` accepts `label` / `pr_state`; `webhook` accepts
 * all three for legacy compatibility.
 */

const labelFilter = z.object({ field: z.literal('label'), value: z.string() });
const statusFilter = z.object({ field: z.literal('status'), value: z.string() });
const prStateFilter = z.object({
  field: z.literal('pr_state'),
  value: z.enum(['draft', 'ready_for_review', 'any']),
});

const sharedFields = {
  id: z.string().min(1),
  name: nodeNameSchema,
  platform: triggerSourceSchema,
  connectionId: z.string().min(1),
  boardConnectionId: z.string().optional(),
};

export const triggerConfigSchema = z.discriminatedUnion('type', [
  z.object({
    ...sharedFields,
    type: z.literal('issues'),
    intervalSec: z.number().int().positive(),
    filters: z.array(z.discriminatedUnion('field', [labelFilter, statusFilter])).default([]),
  }),
  z.object({
    ...sharedFields,
    type: z.literal('pull_requests'),
    intervalSec: z.number().int().positive(),
    filters: z.array(z.discriminatedUnion('field', [labelFilter, prStateFilter])).default([]),
  }),
  z.object({
    ...sharedFields,
    type: z.literal('webhook'),
    event: z.string().min(1),
    filters: z
      .array(z.discriminatedUnion('field', [labelFilter, statusFilter, prStateFilter]))
      .default([]),
  }),
]);
export type TriggerConfig = z.infer<typeof triggerConfigSchema>;

/**
 * Opt-in predicate for trigger variants delivered via Temporal polling
 * Schedules. New variants must explicitly opt in here — adding a future
 * `scheduled` or push-source variant won't silently get a poll Schedule.
 */
export function isPollingTrigger(
  trigger: Pick<TriggerConfig, 'type'> | null | undefined,
): trigger is Extract<TriggerConfig, { type: 'issues' | 'pull_requests' }> {
  return trigger?.type === 'issues' || trigger?.type === 'pull_requests';
}

/**
 * Filter fields legally settable for a given trigger variant. Mirrors the
 * per-variant `filters` discriminator in `triggerConfigSchema` so the UI
 * (and any future non-web caller) doesn't have to re-derive the rule.
 * `issues` exposes `status` only when a board is attached — without a board
 * the source is repo issues, which have no project Status column.
 */
export function offeredFilterFields(
  trigger: TriggerConfig,
): Array<'status' | 'label' | 'pr_state'> {
  switch (trigger.type) {
    case 'pull_requests':
      return ['pr_state', 'label'];
    case 'issues':
      return trigger.boardConnectionId ? ['status', 'label'] : ['label'];
    case 'webhook':
      return ['status', 'label', 'pr_state'];
  }
}

/**
 * Backwards-compat type alias — the old `BoardRef` shape lives on as the
 * `github_projects_v2` connection scope. Re-exported here so call sites that
 * type-imported `BoardRef` keep compiling without a path change.
 */
export type BoardRef = Omit<GithubProjectsV2Scope, 'kind'>;
