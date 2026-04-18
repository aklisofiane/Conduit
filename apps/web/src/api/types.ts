import type {
  AgentEvent,
  DiscoveredTool,
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

export type RunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

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
  nodeType: 'AGENT' | 'TRIGGER';
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  output: unknown;
  usage: { inputTokens?: number; outputTokens?: number; toolCalls?: number; turns?: number } | null;
  workspacePath: string | null;
  error: string | null;
}

export interface ExecutionLogRow {
  id: string;
  runId: string;
  nodeName: string | null;
  ts: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  kind: 'TEXT' | 'TOOL_CALL' | 'TOOL_RESULT' | 'USAGE' | 'SYSTEM';
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

export interface DiscoveredSkill {
  id: string;
  name: string;
  description: string;
  path: string;
  source: 'repo' | 'worker';
  provider: 'claude' | 'codex' | 'both';
}

export type { AgentEvent, DiscoveredTool };

export interface RunUpdateFrame {
  runId: string;
  nodeName: string;
  event: AgentEvent | { type: 'system'; message: string };
  ts: string;
}
