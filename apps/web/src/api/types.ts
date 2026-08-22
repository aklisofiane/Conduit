import type {
  AgentEvent,
  AgentProviderId,
  ConnectionScope,
  ConnectionScopeKind,
  DiscoveredTool,
  ExecutionLogKind,
  LogLevel,
  NodeType,
  RunStatus,
  RunUpdateMessage,
  SkillProviderTag,
  WorkflowDefinition,
} from '@conduit/shared';
import type { TemplateFile, TemplateSummary } from '@conduit/shared/template';
import type { AnalysisPhase, AnalysisStatus } from '@conduit/shared/analysis';
import type { AgentPreset } from '@conduit/shared/agent-preset';

/** Row shape returned by `GET /workflows`. */
export interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  definition: WorkflowDefinition;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  runs: WorkflowRunSummary[];
}

export interface WorkflowRunSummary {
  id: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

export interface RunTrigger {
  source: string;
  mode: string;
  event: string;
  actor?: string;
  issue?: { key: string; title: string; url: string };
  repo?: { owner: string; name: string };
}

/**
 * Run-level token/cost rollup, summed from the run's node runs at
 * finalization. Null on runs that predate this feature or finished without a
 * completed agent node. `totalCostUsd` is serialized from a Decimal to a number.
 */
export interface RunCostRollup {
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalCostUsd: number | null;
}

export interface WorkflowRunListItem extends WorkflowRunSummary, RunCostRollup {
  workflowId: string;
  trigger: RunTrigger;
  nodes: {
    id: string;
    nodeName: string;
    status: RunStatus;
    startedAt: string | null;
    finishedAt: string | null;
  }[];
}

export interface RunDetail extends WorkflowRunSummary, RunCostRollup {
  workflowId: string;
  workflow: { id: string; name: string; definition: WorkflowDefinition };
  trigger: RunTrigger;
  temporalWorkflowId: string | null;
  temporalRunId: string | null;
  nodes: NodeRunRow[];
}

/**
 * The exact price snapshotted onto a node run at completion, so the cost is
 * self-explaining and immune to later price edits. USD per 1M tokens.
 */
export interface PriceSnapshot {
  inputPerM: number;
  outputPerM: number;
  source: 'default' | 'override';
}

export interface NodeRunRow {
  id: string;
  runId: string;
  nodeName: string;
  nodeType: NodeType;
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  output: {
    files?: string[];
    workspacePath?: string;
    head?: string;
    workspaceKind?: 'fresh-tmpdir' | 'repo-clone' | 'inherit' | 'ticket-branch';
    isBranchedWorktree?: boolean;
    branchName?: string;
  } | null;
  /**
   * Per-node token usage. `inputTokens` is the full-rate (non-cached) portion;
   * `cachedInputTokens` and `cacheCreationInputTokens` are the cache buckets.
   * Display "input" totals should sum all three. `reasoningOutputTokens` is a
   * subset of `outputTokens` (display only — never add it to a total).
   */
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    cacheCreationInputTokens?: number;
    reasoningOutputTokens?: number;
    toolCalls?: number;
    turns?: number;
  } | null;
  /** Snapshot-at-write dollar cost of this node (Decimal → number). Null on non-agent / pre-feature nodes. */
  costUsd: number | null;
  priceSnapshot: PriceSnapshot | null;
  workspacePath: string | null;
  conduitSummary: string | null;
  error: string | null;
}

export interface ExecutionLogRow {
  id: string;
  runId: string;
  nodeName: string | null;
  ts: string;
  level: LogLevel;
  kind: ExecutionLogKind;
  payload: unknown;
}

export interface CredentialRow {
  id: string;
  platform: 'GITHUB' | 'GITLAB' | 'JIRA' | 'SLACK' | 'DISCORD';
  name: string;
  hostUrl: string | null;
  metadata: {
    source?: 'oauth' | 'manual';
    githubLogin?: string;
    scopes?: string[];
    /**
     * Written by the API's OAuth→Credential mirror (`upsertOAuthDerived`).
     * `accountRowId` is the Better Auth `account` row this credential mirrors —
     * how the Linked accounts panel pairs a credential with a linked account.
     */
    accountRowId?: string;
    providerAccountId?: string;
    providerLogin?: string;
    /**
     * ISO expiry of the mirrored OAuth access token, written by
     * `upsertOAuthDerived` on every (re)mirror — so it moves forward each time
     * the API's refresher rotates the token. Absent on rows mirrored before
     * that key existed and on providers whose tokens don't expire (GitHub with
     * token expiration off), which the staleness hint treats as "unknown".
     */
    tokenExpiresAt?: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  connectionCount: number;
  suffix: string;
}

export interface ProviderConfig {
  id: string;
  providerId: AgentProviderId;
  baseUrl: string | null;
  suffix: string;
  updatedAt: string;
}

/**
 * A per-org per-model price override returned by `GET /model-pricing`. Only
 * overridden models have a row; models without one fall back to the shipped
 * `MODEL_PRICING` default. Rates are USD per 1M tokens.
 */
export interface ModelPriceRow {
  model: string;
  inputPerM: number;
  outputPerM: number;
  updatedAt: string;
}

export interface ConnectionRow {
  id: string;
  name: string;
  credentialId: string;
  credential: {
    id: string;
    name: string;
    platform: 'GITHUB' | 'GITLAB' | 'JIRA' | 'SLACK' | 'DISCORD';
    hostUrl: string | null;
  };
  scope: ConnectionScope;
  createdAt: string;
  updatedAt: string;
}

export type { ConnectionScope, ConnectionScopeKind, TemplateSummary, AgentPreset };

/** A component the analyzer couldn't turn into a review, with the reason. */
export interface DroppedComponent {
  component: string;
  reason: string;
}

/**
 * Repo-analysis lifecycle row returned by `GET /connections/:id/analysis`.
 * `null` (not this shape) when the connection has never been analyzed.
 * `resultBundle` is populated once `status` reaches READY; `error` once FAILED.
 */
export interface ConnectionAnalysis {
  id: string;
  status: AnalysisStatus;
  phase: AnalysisPhase;
  resultBundle: TemplateFile | null;
  droppedComponents: DroppedComponent[] | null;
  error: string | null;
  /** ISO timestamp set once the user imports these suggestions; null otherwise. */
  importedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TemplateBinding =
  | { mode: 'existing'; connectionId: string }
  | {
      mode: 'new';
      name: string;
      credentialId: string;
      scope: ConnectionScope;
    };

export interface CreatedFromTemplate {
  templateId: string;
  workflows: { id: string; name: string }[];
}

export interface DiscoveredSkill {
  id: string;
  name: string;
  description: string;
  path: string;
  source: 'repo' | 'worker';
  provider: SkillProviderTag;
  /** Display bucket — a plugin name, or the synthetic `Worker` / `Repo` groups. */
  group: string;
  /** Marketplace a plugin skill came from, when applicable. */
  marketplace?: string;
}

export type { AgentEvent, DiscoveredTool, RunStatus, NodeType, ExecutionLogKind };

export type RunUpdateFrame = RunUpdateMessage;
