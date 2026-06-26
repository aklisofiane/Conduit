import { z } from 'zod';
import { CRON_EXPRESSION_RE } from '../trigger/config';

/**
 * Structured Design output, one per component. Written by each Design agent
 * as JSON to a fixed workspace path (see `ANALYSIS_DRAFT_PATH`) — the same
 * JSON-artifact + Zod-validate + bounded-retry convention as the Discover
 * `ComponentManifest`.
 *
 * The agent selects **domain keys** from the reviewer-domain catalog (not the
 * prompt text — the catalog owns that) and a **cadence** (cron) weighted by
 * churn × criticality. Assemble code stitches surviving drafts into one
 * multi-workflow `TemplateFile`.
 */
export const workflowDraftSchema = z.object({
  /** Echo of the component this draft reviews — matches `Component.name`. */
  component: z.string().min(1),
  /** Human-facing workflow name shown on the suggestion card. */
  workflowName: z.string().min(1),
  /** One-line "what this reviews", for the gallery card. */
  summary: z.string().min(1),
  /** Why these domains + this cadence were chosen, for the gallery card. */
  rationale: z.string().min(1),
  /**
   * Selected reviewer-domain keys from `REVIEWER_DOMAINS`. Assemble maps each
   * known key to a `code-analyst` node; unknown keys are dropped there. At
   * least one is required — a draft with no domains can't review anything.
   */
  domains: z.array(z.string().min(1)).min(1),
  /** 5-field POSIX cron cadence. Temporal does final semantic validation. */
  cron: z
    .string()
    .regex(CRON_EXPRESSION_RE, 'Invalid cron expression — expected 5 space-separated fields'),
  /** Component path glob(s) the generated Scope node scopes the review to. */
  paths: z.array(z.string().min(1)).min(1),
});
export type WorkflowDraft = z.infer<typeof workflowDraftSchema>;

/**
 * A component that failed Design fan-out after its bounded retries — surfaced
 * in the suggestions gallery so dropped components are never silently
 * truncated.
 */
export const droppedComponentSchema = z.object({
  component: z.string().min(1),
  reason: z.string().min(1),
});
export type DroppedComponent = z.infer<typeof droppedComponentSchema>;

export const droppedComponentsSchema = z.array(droppedComponentSchema);
