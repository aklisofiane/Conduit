/**
 * Default Temporal task queue name. Both the API (which starts workflows)
 * and the worker (which polls them) must agree — keep the literal here.
 */
export const DEFAULT_TEMPORAL_TASK_QUEUE = 'conduit-workflows';

/**
 * Workflow-type registry. The literal strings here are the contract between
 * the API (which starts workflows / creates schedules) and the worker (which
 * registers the workflow implementations). Keeping them in one place avoids
 * drift.
 */
export const AGENT_WORKFLOW_TYPE = 'agentWorkflow';
export const POLL_WORKFLOW_TYPE = 'pollWorkflow';
export const CRON_WORKFLOW_TYPE = 'cronWorkflow';
export const REPO_ANALYSIS_WORKFLOW_TYPE = 'repoAnalysisWorkflow';

/**
 * Build the frozen, human-readable slug woven into every Temporal id as a
 * cosmetic prefix. Pure — no DB, safe to call inside the Temporal V8 sandbox.
 * The resolve-and-freeze logic (which looks up the source connection name and
 * persists the result) lives in the API where Prisma is available; this only
 * composes the string from values already in hand.
 *
 * Each segment is kebab-slugified to `[a-z0-9-]` and capped at 20 chars, then
 * joined `<wf>-<conn>`. Returns `''` when nothing usable remains:
 *
 *   - no connection name (draft / no trigger / deleted connection) → name only
 *   - connection name slugs to empty                               → name only
 *   - workflow name slugs to empty                                 → `''`
 *
 * The composed slug is never parsed back — determinism always recomputes from
 * `(cuid, frozen slug)` — so dashes inside the slug are harmless.
 */
export function buildTemporalSlug(workflowName: string, connectionName?: string): string {
  const wf = slugSegment(workflowName ?? '');
  if (!wf) return '';
  const conn = connectionName ? slugSegment(connectionName) : '';
  return conn ? `${wf}-${conn}` : wf;
}

const SLUG_SEGMENT_MAX = 20;

/** Kebab-slugify one segment to `[a-z0-9-]`, capped at {@link SLUG_SEGMENT_MAX}. */
function slugSegment(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_SEGMENT_MAX)
    .replace(/-+$/g, '');
}

/** Weave the frozen slug in front of an id. Empty/omitted → id unchanged. */
function withSlug(id: string, slug?: string): string {
  return slug ? `${slug}-${id}` : id;
}

/**
 * Deterministic id for the Temporal Schedule driving any schedule-backed
 * workflow (polling or cron). One schedule per Conduit workflow — the
 * action (poll vs cron) is chosen at upsert time by the trigger variant.
 * The `poll-` prefix is preserved for backwards compatibility with any
 * schedules already in the Temporal namespace.
 *
 * `slug` is a cosmetic prefix only — the immutable `workflowId` stays the
 * sole determinism anchor. Omitted/empty → today's slug-less id verbatim, so
 * an un-frozen workflow keeps matching its existing `poll-<cuid>` schedule.
 */
export function workflowScheduleId(workflowId: string, slug?: string): string {
  return `poll-${withSlug(workflowId, slug)}`;
}

/**
 * Deterministic Temporal workflow id for a poll run. Scoped by workflow id
 * only — overlap policy on the schedule (SKIP) is what prevents two poll
 * cycles from running concurrently for the same Conduit workflow. `slug` is a
 * cosmetic prefix; omitted/empty → today's slug-less id verbatim.
 */
export function pollWorkflowId(workflowId: string, slug?: string): string {
  return `poll-run-${withSlug(workflowId, slug)}`;
}

/**
 * Deterministic Temporal workflow id for a cron tick. Same shape as
 * `pollWorkflowId` so the schedule overlap policy (SKIP) prevents a slow
 * agent run from overlapping its successor tick. `slug` is a cosmetic prefix;
 * omitted/empty → today's slug-less id verbatim.
 */
export function cronWorkflowId(workflowId: string, slug?: string): string {
  return `cron-run-${withSlug(workflowId, slug)}`;
}

/**
 * Temporal workflow id for an `agentWorkflow` start.
 *
 *   - `ticket-branch` workflows → `run-<workflowId>-<ticketKey>`. Deterministic
 *     per `(Conduit workflow, ticket)` so a duplicate trigger while a run is
 *     in flight collides with the in-flight ID and Temporal rejects the
 *     start with `WorkflowExecutionAlreadyStarted`. After termination the
 *     ID is reusable (see `WorkflowIdReusePolicy.ALLOW_DUPLICATE` in the
 *     API/worker) so Dev → Review → Dev board cycles re-fire the Worker.
 *
 *   - All other workflows → `run-<runId>`. Per-run uniqueness; no dedup.
 *
 * `slug` is a cosmetic prefix only — dedup identity still rests on the
 * `(workflowId, ticketKey)` / `runId` suffix. Omitted/empty → today's
 * slug-less id verbatim, so a slugged start still collides with a slug-less
 * in-flight run only if both omit it; the freeze happens before any run
 * starts, so in practice every caller for a given workflow agrees.
 */
export function agentWorkflowId(runId: string, ticketLock?: TicketLock, slug?: string): string {
  if (ticketLock) {
    return `run-${withSlug(ticketLock.workflowId, slug)}-${ticketLock.ticketKey}`;
  }
  return `run-${withSlug(runId, slug)}`;
}

/**
 * Deterministic Temporal workflow id for a `repoAnalysisWorkflow` start.
 * Scoped by the `RepoAnalysis.id` — one in-flight analysis per row; the API
 * already rejects a second analysis while one is running for the connection.
 */
export function repoAnalysisWorkflowId(analysisId: string): string {
  return `analysis-run-${analysisId}`;
}

/** Dedup key for `ticket-branch` workflow starts. See `agentWorkflowId`. */
export interface TicketLock {
  workflowId: string;
  ticketKey: string;
}
