import type { TriggerSource } from '../platform/index';
import type { TriggerConfig } from '../trigger/index';
import type { TriggerEvent } from '../trigger/index';

/**
 * The **analysis adapter** — a named contract for reusing `runAgentNode`
 * without the workflow-definition interpreter. `repoAnalysisWorkflow`
 * bypasses the interpreter, so it forges the inputs `runAgentNode` normally
 * receives: a synthetic `analysis` `TriggerEvent` and a single-trigger
 * `TriggerConfig[]` that carries the repo connection. These are deliberate,
 * documented stubs — not ad-hoc forging. If they grow awkward, the follow-up
 * is to extract a lower-level `runSingleAgent` core shared by both paths.
 */

/** Fixed workspace path the Discover agent writes its `ComponentManifest` JSON to. */
export const ANALYSIS_MANIFEST_PATH = '.conduit/ComponentManifest.json';

/** Fixed workspace path each Design agent writes its `WorkflowDraft` JSON to. */
export const ANALYSIS_DRAFT_PATH = '.conduit/WorkflowDraft.json';

/** Node name of the Discover agent (the fixed-branch entry of the analysis run). */
export const ANALYSIS_DISCOVER_NODE = 'Discover';

/** `TriggerEvent.event` value identifying the synthetic analysis trigger. */
export const ANALYSIS_TRIGGER_EVENT = 'analysis';

/** Synthetic trigger id/name woven into the forged `TriggerConfig`. */
const ANALYSIS_TRIGGER_ID = 'analysis-trigger';
const ANALYSIS_TRIGGER_NAME = 'AnalysisTrigger';

/**
 * Connection placeholder generated bundles carry for the repo binding — same
 * alias `templates/nightly-review.json` uses, so suggestions flow through the
 * existing import / instantiate path. Pre-bound to the analyzed connection at
 * import time → one-click import.
 */
export const ANALYSIS_REPO_PLACEHOLDER = '<github-repo>';

/**
 * Build the synthetic `analysis` `TriggerEvent` the analyzer agents run under.
 * `mode: 'scheduled'` keeps `issue`/`pr` absent (documented N/A for analysis);
 * `repo` carries the analyzed repo so agent context is populated.
 */
export function buildAnalysisTriggerEvent(input: {
  platform: TriggerSource;
  repo: { owner: string; name: string };
}): TriggerEvent {
  return {
    source: input.platform,
    mode: 'scheduled',
    event: ANALYSIS_TRIGGER_EVENT,
    payload: {},
    repo: input.repo,
  };
}

/**
 * Forge the single-trigger `TriggerConfig[]` `runAgentNode` reads to resolve
 * the entry workspace's connection (and which the `fixed-branch` Discover node
 * clones). The `cron` fields are inert structural filler — this trigger is
 * never registered as a Temporal Schedule; only `connectionId` and `branch`
 * are consumed.
 */
export function analysisTriggerConfig(input: {
  connectionId: string;
  platform: TriggerSource;
  branch: string;
}): TriggerConfig[] {
  return [
    {
      id: ANALYSIS_TRIGGER_ID,
      name: ANALYSIS_TRIGGER_NAME,
      platform: input.platform,
      connectionId: input.connectionId,
      type: 'cron',
      cron: '0 0 * * *',
      timezone: 'UTC',
      branch: input.branch,
    },
  ];
}
