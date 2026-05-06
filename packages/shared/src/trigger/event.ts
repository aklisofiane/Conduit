import { z } from 'zod';
import { triggerSourceSchema } from '../platform/index';

/**
 * Normalized event produced by every trigger mode (webhook, polling).
 * Passed to every downstream node as `AgentContext.trigger`.
 *
 * `issue.id` is the platform's opaque identifier (e.g. GitHub `node_id`).
 * `issue.key` is the user-visible identifier as a string — `"42"` for GitHub,
 * `"PROJ-123"` for Jira. Anything needing a stable human-readable ticket id
 * (branch names, DB keys, Temporal workflow IDs) reads `issue.key`.
 *
 * `pr` is populated only on PR-shaped events (`pull_request.*` and PR-scoped
 * `issue_comment.created`). It carries the head/base refs the workspace
 * manager needs to land directly on the PR's branch — `ticket-branch`'s
 * PR arm uses `pr.headRef` instead of deriving a `conduit/<id>-<slug>` name.
 * `issue` continues to be populated for PR events so trigger filters that
 * key on `issue.key` keep working unchanged.
 */
export const triggerEventSchema = z.object({
  source: triggerSourceSchema,
  mode: z.enum(['webhook', 'polling']),
  event: z.string().min(1),
  payload: z.record(z.unknown()),
  repo: z
    .object({
      owner: z.string().min(1),
      name: z.string().min(1),
    })
    .optional(),
  issue: z
    .object({
      id: z.string().min(1),
      key: z.string().min(1),
      title: z.string(),
      url: z.string().url(),
    })
    .optional(),
  pr: z
    .object({
      headRef: z.string().min(1),
      baseRef: z.string().min(1),
      headRepo: z
        .object({
          owner: z.string().min(1),
          name: z.string().min(1),
        })
        .optional(),
    })
    .optional(),
  actor: z.string().optional(),
});
export type TriggerEvent = z.infer<typeof triggerEventSchema>;
