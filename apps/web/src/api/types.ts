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
import type { TemplateSummary } from '@conduit/shared/template';
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

export interface WorkflowRunListItem extends WorkflowRunSummary {
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

export interface RunDetail extends WorkflowRunSummary {
  workflowId: string;
  workflow: { id: string; name: string; definition: WorkflowDefinition };
  trigger: RunTrigger;
  temporalWorkflowId: string | null;
  temporalRunId: string | null;
  nodes: NodeRunRow[];
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
  usage: { inputTokens?: number; outputTokens?: number; toolCalls?: number; turns?: number } | null;
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
  metadata: {
    source?: 'oauth' | 'manual';
    githubLogin?: string;
    scopes?: string[];
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

export interface ConnectionRow {
  id: string;
  name: string;
  credentialId: string;
  credential: {
    id: string;
    name: string;
    platform: 'GITHUB' | 'GITLAB' | 'JIRA' | 'SLACK' | 'DISCORD';
  };
  scope: ConnectionScope;
  createdAt: string;
  updatedAt: string;
}

export type { ConnectionScope, ConnectionScopeKind, TemplateSummary, AgentPreset };

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
}

export type { AgentEvent, DiscoveredTool, RunStatus, NodeType, ExecutionLogKind };

export type RunUpdateFrame = RunUpdateMessage;
