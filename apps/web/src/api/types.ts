import type {
  AgentEvent,
  DiscoveredTool,
  ExecutionLogKind,
  LogLevel,
  NodeType,
  RunStatus,
  RunUpdateMessage,
  WorkflowDefinition,
} from '@conduit/shared';

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

export interface RunDetail extends WorkflowRunSummary {
  workflowId: string;
  workflow: { id: string; name: string; definition: WorkflowDefinition };
  trigger: {
    source: string;
    mode: string;
    event: string;
    actor?: string;
    issue?: { key: string; title: string; url: string };
    repo?: { owner: string; name: string };
  };
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
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  connectionCount: number;
  suffix: string;
}

export interface ConnectionRow {
  id: string;
  workflowId: string;
  alias: string;
  credentialId: string;
  credential: {
    id: string;
    name: string;
    platform: 'GITHUB' | 'GITLAB' | 'JIRA' | 'SLACK' | 'DISCORD';
  };
  owner: string | null;
  repo: string | null;
  hasWebhookSecret: boolean;
  webhookSecretSuffix: string | null;
}

export interface DiscoveredSkill {
  id: string;
  name: string;
  description: string;
  path: string;
  source: 'repo' | 'worker';
  provider: 'claude' | 'codex' | 'both';
}

export type { AgentEvent, DiscoveredTool, RunStatus, NodeType, ExecutionLogKind };

export type RunUpdateFrame = RunUpdateMessage;
