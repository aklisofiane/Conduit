import { z } from 'zod';

/**
 * Per-agent allowlist for end-of-run issue / PR writeback. Presence of this
 * field on an `AgentConfig` is the "feature is enabled" signal — all three
 * arrays may be empty (treated as enabled-but-unselected; the runtime
 * skips the writeback turn rather than synthesizing an empty directive).
 *
 * `allowedStatuses` / `allowedLabels` are the values the agent may *set* —
 * picked at config time from the workflow's GitHub trigger connection
 * (Project v2 Status options + repo labels). The label that *gated* the run
 * is removed automatically (see `resolveWritebackContext` — it's the stage
 * the run just consumed), so the handoff is a remove-the-trigger-label,
 * add-the-next-one swap without the template spelling out the removal.
 *
 * `allowedPrStates` is the PR-native open/closed axis — repo-level, so it
 * needs no project board. It only applies to `pull_requests`-triggered runs
 * (the UI offers it only there, and `issueWritebackPrompt` emits the
 * directive only when the run is PR-shaped); on issue/cron runs it's inert.
 * Merging is deliberately excluded — that's a heavier action with a merge
 * method and conflict handling, out of scope here.
 *
 * At run time the picked values are interpolated verbatim into the trailing
 * user message — no schema-level enforcement, no post-run validation. The
 * allowlist is encoded entirely in prompt wording. The field name stays
 * `issueWriteback` (no data migration); the feature is "issue / PR".
 */
export const agentIssueWritebackSchema = z.object({
  allowedStatuses: z.array(z.string().min(1)).default([]),
  allowedLabels: z.array(z.string().min(1)).default([]),
  allowedPrStates: z.array(z.enum(['open', 'closed'])).default([]),
});
export type AgentIssueWriteback = z.infer<typeof agentIssueWritebackSchema>;
