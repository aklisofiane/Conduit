import { z } from 'zod';
import { CRON_EXPRESSION_RE } from '../trigger/config';
import { NODE_NAME_PATTERN } from '../agent/node-name';

/**
 * Safe charset for a reviewer name. The name is reused in three places:
 *   1. a workflow node `name` (and the `Edge.from`/`Edge.to` references to it),
 *   2. a `.conduit/<name>.md` findings filename, and
 *   3. a `## <name>` ScopeManifest heading the Scope/reviewer handshake keys off.
 *
 * The node-name use is the strictest of the three: `agentConfigSchema.name`
 * and `edgeSchema` both enforce `NODE_NAME_PATTERN` (`/^[A-Za-z_][A-Za-z0-9_]*$/`),
 * so a name with spaces or hyphens would make the assembled bundle fail
 * `templateFileSchema.parse`. We therefore reuse that exact pattern here — it
 * is also trivially safe as a filename (no path separators or `..`) and as a
 * Markdown heading. (Deliberately tighter than the spec's
 * "letters/digits/spaces/hyphens/underscores" suggestion, which the runtime
 * node-name schema would reject downstream.)
 */

/** A single agent-authored reviewer block in a draft. */
export const reviewerDraftSchema = z.object({
  /**
   * Reviewer name — used as the node name (+ edge endpoints), the
   * `.conduit/<name>.md` filename, and the `## <name>` ScopeManifest heading.
   * Constrained to `NODE_NAME_PATTERN` (see the charset note above).
   */
  name: z
    .string()
    .min(1)
    .regex(
      NODE_NAME_PATTERN,
      'Reviewer name must match /^[A-Za-z_][A-Za-z0-9_]*$/ (letters, digits, underscores; no leading digit)',
    ),
  /** Agent-authored, component-tailored reviewer prompt body. */
  instructions: z.string().min(1),
});
export type ReviewerDraft = z.infer<typeof reviewerDraftSchema>;

/**
 * Structured Design output, one per component. Written by each Design agent
 * as JSON to a fixed workspace path (see `ANALYSIS_DRAFT_PATH`) — the same
 * JSON-artifact + Zod-validate + bounded-retry convention as the Discover
 * `ComponentManifest`.
 *
 * The agent **authors the prose** here: a component-tailored Scope prompt body
 * (`scopeInstructions`) and a set of named `reviewers`, each with its own
 * authored instructions, plus a **cadence** (cron) weighted by churn ×
 * criticality and an echo of the component paths. Assemble code keeps the
 * fixed topology and *appends* the deterministic I/O-contract glue onto this
 * authored prose, then stitches surviving drafts into one multi-workflow
 * `TemplateFile`.
 */
export const workflowDraftSchema = z.object({
  /** Echo of the component this draft reviews — matches `Component.name`. */
  component: z.string().min(1),
  /** Human-facing workflow name shown on the suggestion card. */
  workflowName: z.string().min(1),
  /** One-line "what this reviews", for the gallery card. */
  summary: z.string().min(1),
  /** Why these reviewers + this cadence were chosen, for the gallery card. */
  rationale: z.string().min(1),
  /**
   * Agent-authored Scope prompt body. Assemble appends the path-scoping, diff
   * window, `## <ReviewerName>` headings, and `NO_CHANGES` contract glue.
   */
  scopeInstructions: z.string().min(1),
  /**
   * Agent-authored reviewers (at least one). Each becomes a `code-analyst`
   * node; assemble appends the ScopeManifest-read + findings-output contract
   * glue. Names must be unique within a draft (also re-enforced in assemble
   * after sanitization).
   */
  reviewers: z
    .array(reviewerDraftSchema)
    .min(1)
    .refine((reviewers) => new Set(reviewers.map((r) => r.name)).size === reviewers.length, {
      message: 'Reviewer names must be unique within a draft',
    }),
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
