import { z } from 'zod';
import { nodeNameSchema } from '../agent/node-name';
import { triggerSourceSchema } from '../platform/index';
import { triggerFilterSchema } from './filter';
import { triggerModeSchema } from './mode';
import type { GithubProjectsV2Scope } from '../connection/scope';

/**
 * Persisted trigger shape on `WorkflowDefinition.triggers[]`. `name` shares
 * a namespace with agent names so `Edge.from` can reference either.
 *
 * Connections are referenced by ID through two named slots:
 *
 *   - `connectionId`        — the source binding (today: a `github_repo`
 *     Connection on the workflow). Required.
 *   - `boardConnectionId`   — present when the trigger mode targets a board
 *     (`polling { source: 'board' }` or `webhook { event:
 *     'board.column.changed' }`). Each Connection's `scope.kind` is checked
 *     against the slot's role at the API boundary; the validator only sees
 *     IDs.
 */
export const triggerConfigSchema = z.object({
  id: z.string().min(1),
  name: nodeNameSchema,
  platform: triggerSourceSchema,
  connectionId: z.string().min(1),
  boardConnectionId: z.string().optional(),
  mode: triggerModeSchema,
  filters: z.array(triggerFilterSchema).default([]),
});
export type TriggerConfig = z.infer<typeof triggerConfigSchema>;

/**
 * Backwards-compat type alias — the old `BoardRef` shape lives on as the
 * `github_projects_v2` connection scope. Re-exported here so call sites that
 * type-imported `BoardRef` keep compiling without a path change.
 */
export type BoardRef = Omit<GithubProjectsV2Scope, 'kind'>;
