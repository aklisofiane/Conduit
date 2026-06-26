import type { AgentProviderId } from '../agent/index';
import type { TriggerEvent } from '../trigger/index';

/**
 * Minimal expanded preset the Assemble step needs to materialize a concrete
 * generated-workflow node (the persisted bundle is the runtime `TemplateFile`
 * shape, which inlines instructions rather than carrying `presetId`). Resolved
 * by the API from its loaded agent presets and passed into the workflow so the
 * worker never has to load preset markdown itself.
 */
export interface AnalysisPreset {
  provider: AgentProviderId;
  model: string;
  instructions: string;
}

/**
 * The three presets generated review workflows reuse — `scope` + `code-analyst`
 * (one per selected domain) + `issue-publisher`, wired exactly like
 * `templates/nightly-review.json`.
 */
export interface AssemblyPresets {
  scope: AnalysisPreset;
  codeAnalyst: AnalysisPreset;
  issuePublisher: AnalysisPreset;
}

/**
 * Input to `repoAnalysisWorkflow`. The API mints the internal run + analysis
 * rows, resolves the analyzed connection's repo, loads the assembly presets,
 * and starts the workflow with this payload.
 */
export interface RepoAnalysisWorkflowInput {
  /** `RepoAnalysis.id` — the user-facing lifecycle row. */
  analysisId: string;
  /** `WorkflowRun.id` of the hidden internal run hosting analyzer `NodeRun`s. */
  internalRunId: string;
  /** Per-org hidden SYSTEM `Workflow.id` the internal run FKs to. */
  systemWorkflowId: string;
  orgId: string;
  /** Repo-scoped `Connection.id` being analyzed. */
  connectionId: string;
  /** Synthetic `analysis` trigger event (see `buildAnalysisTriggerEvent`). */
  triggerEvent: TriggerEvent;
  /** Expanded presets the Assemble step stitches into generated workflows. */
  presets: AssemblyPresets;
}
