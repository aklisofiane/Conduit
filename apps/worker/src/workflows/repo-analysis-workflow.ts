import { proxyActivities } from '@temporalio/workflow';
import {
  analysisTriggerConfig,
  errorMessage,
  type Component,
  type DroppedComponent,
  type RepoAnalysisWorkflowInput,
  type TriggerConfig,
  type TriggerEvent,
  type WorkflowDraft,
} from '@conduit/shared';
import type * as activities from '../activities/index';
import { designNode, discoverNode } from './repo-analysis-nodes';

// Agent sessions aren't resumable mid-conversation — fail the node rather than
// retry from scratch. The workflow's own loop handles analyzer retries.
const { runAgentNode } = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 hours',
  heartbeatTimeout: '120s',
  retry: { maximumAttempts: 1 },
});

// Reading a JSON artifact never benefits from a Temporal retry — a missing /
// invalid file won't fix itself, and the workflow re-runs the agent instead.
const { readComponentManifestActivity, readWorkflowDraftActivity } = proxyActivities<
  typeof activities
>({
  startToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 1 },
});

const {
  cloneAnalysisWorkspaceActivity,
  updateAnalysisPhaseActivity,
  assembleSuggestionsActivity,
  cleanupRunActivity,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    initialInterval: '2s',
    backoffCoefficient: 2,
    maximumInterval: '60s',
    maximumAttempts: 3,
    nonRetryableErrorTypes: ['ValidationError', 'UnauthorizedError'],
  },
});

const ANALYSIS_WORKFLOW_NAME = 'Repo Analysis';
/** Discover / Design re-run the agent up to this many times on a bad artifact. */
const ANALYZER_MAX_ATTEMPTS = 3;
/** Design fan-out concurrency cap — overflow runs in subsequent batches. */
const DESIGN_CONCURRENCY = 12;

interface RunContext {
  workflowId: string;
  workflowName: string;
  orgId: string;
  runId: string;
}

/**
 * Dedicated Temporal workflow orchestrating component-based review-workflow
 * suggestion generation. Unlike `agentWorkflow` (which topo-sorts a static
 * node DAG), this fans out dynamically over N-unknown components. It reuses
 * `runAgentNode` at the activity level via the analysis adapter (synthetic
 * `analysis` trigger), hosting analyzer `NodeRun`s under the hidden internal
 * run. V8 sandbox: graph arithmetic + activity dispatch only — all I/O is in
 * activities.
 */
export async function repoAnalysisWorkflow(input: RepoAnalysisWorkflowInput): Promise<void> {
  const { analysisId, internalRunId, systemWorkflowId, orgId, connectionId, triggerEvent, presets } =
    input;
  const runCtx: RunContext = {
    workflowId: systemWorkflowId,
    workflowName: ANALYSIS_WORKFLOW_NAME,
    orgId,
    runId: internalRunId,
  };

  let failure: string | undefined;
  try {
    await updateAnalysisPhaseActivity({ analysisId, status: 'ANALYZING', phase: 'DISCOVER' });

    const { repo, platform, defaultBranch } = await cloneAnalysisWorkspaceActivity({
      connectionId,
    });
    const triggers = analysisTriggerConfig({ connectionId, platform, branch: defaultBranch });

    // ---- Discover (bounded retry on a bad/missing manifest) ----
    const discovered = await attemptAnalyzer(async () => {
      const output = await runAgentNode({
        ...runCtx,
        node: discoverNode(defaultBranch),
        mcpServers: [],
        triggers,
        triggerEvent,
      });
      const manifest = await readComponentManifestActivity({
        workspacePath: output.workspacePath,
      });
      return { manifest, output };
    });
    if (!discovered.ok) {
      throw new Error(
        `Discover failed to produce a valid ComponentManifest after ${ANALYZER_MAX_ATTEMPTS} attempts: ${discovered.err}`,
      );
    }
    const { manifest, output: discover } = discovered.value;

    // ---- Design fan-out (≤DESIGN_CONCURRENCY at a time, allSettled-style) ----
    // Each Design node branches a read-only worktree off Discover's still-live
    // fixed-branch worktree. Known limitation: Discover's worktree heartbeat
    // stops when its activity returns, so during a long Design phase a
    // *concurrent* run on the same repo+default-branch could, on its eviction
    // recovery path, judge Discover's worktree stale and remove it — failing the
    // remaining Design nodes (they're then dropped, not silently lost). Narrow
    // trigger; a proper fix is run-scoped (not activity-scoped) worktree
    // heartbeating, tracked as a follow-up.
    await updateAnalysisPhaseActivity({ analysisId, phase: 'DESIGN' });
    const drafts: WorkflowDraft[] = [];
    const dropped: DroppedComponent[] = [];
    const components = manifest.components;
    for (let start = 0; start < components.length; start += DESIGN_CONCURRENCY) {
      const batch = components.slice(start, start + DESIGN_CONCURRENCY);
      const settled = await Promise.all(
        batch.map((component, i) =>
          designOne(component, start + i, runCtx, triggers, triggerEvent, {
            upstreamWorkspacePath: discover.workspacePath,
            upstreamHead: discover.head,
          }),
        ),
      );
      for (const result of settled) {
        if (result.ok) drafts.push(result.draft);
        else dropped.push(result.dropped);
      }
    }

    // ---- Assemble + persist terminal state ----
    await updateAnalysisPhaseActivity({ analysisId, phase: 'ASSEMBLE' });
    await assembleSuggestionsActivity({
      analysisId,
      drafts,
      dropped,
      repo,
      platform,
      defaultBranch,
      presets,
    });
  } catch (err) {
    // Hard failures (clone died, Discover never parsed) surface on the row;
    // we don't rethrow — there's no value in Temporal retrying the whole
    // analysis, and cleanup must still tear down the workspace.
    failure = errorMessage(err);
    await updateAnalysisPhaseActivity({ analysisId, status: 'FAILED', error: failure });
  } finally {
    await cleanupRunActivity({
      runId: internalRunId,
      status: failure ? 'FAILED' : 'COMPLETED',
      error: failure,
    });
  }
}

type DesignOutcome =
  | { ok: true; draft: WorkflowDraft }
  | { ok: false; dropped: DroppedComponent };

/**
 * Run an analyzer step (agent run + artifact read) up to `ANALYZER_MAX_ATTEMPTS`
 * times, returning the last error if every attempt fails. `runAgentNode` has
 * `maximumAttempts: 1`, so a transient agent-activity failure is retried by this
 * loop too — not just a bad/missing artifact. Neither is fixable by a Temporal
 * retry, so the workflow re-runs the whole step instead.
 */
async function attemptAnalyzer<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; err: string }> {
  let lastErr = '';
  for (let attempt = 1; attempt <= ANALYZER_MAX_ATTEMPTS; attempt++) {
    try {
      return { ok: true, value: await fn() };
    } catch (err) {
      lastErr = errorMessage(err);
    }
  }
  return { ok: false, err: lastErr };
}

/**
 * Design one component: run its agent in a branched worktree off Discover and
 * read back its `WorkflowDraft`, with the same bounded-retry convention as
 * Discover. A component that never produces a valid draft is dropped (recorded
 * in `droppedComponents`) rather than sinking the whole analysis.
 */
async function designOne(
  component: Component,
  index: number,
  runCtx: RunContext,
  triggers: TriggerConfig[],
  triggerEvent: TriggerEvent,
  upstream: { upstreamWorkspacePath: string; upstreamHead: string | undefined },
): Promise<DesignOutcome> {
  const result = await attemptAnalyzer(async () => {
    const output = await runAgentNode({
      ...runCtx,
      node: designNode(component, index),
      mcpServers: [],
      triggers,
      triggerEvent,
      upstreamWorkspacePath: upstream.upstreamWorkspacePath,
      upstreamHead: upstream.upstreamHead,
      parallelBranch: true,
    });
    return readWorkflowDraftActivity({ workspacePath: output.workspacePath });
  });
  return result.ok
    ? { ok: true, draft: result.value }
    : { ok: false, dropped: { component: component.name, reason: result.err || 'design failed' } };
}
