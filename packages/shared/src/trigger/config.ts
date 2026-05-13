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
 * Backwards-compat type alias — the old `BoardRef` shape lives on as the
 * `github_projects_v2` connection scope. Re-exported here so call sites that
 * type-imported `BoardRef` keep compiling without a path change.
 */
export type BoardRef = Omit<GithubProjectsV2Scope, 'kind'>;
