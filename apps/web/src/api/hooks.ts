import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DiscoveredTool, McpTransport, WorkflowDefinition } from '@conduit/shared';
import { api } from './client.js';
import type {
  ConnectionRow,
  CreatedFromTemplate,
  CredentialRow,
  DiscoveredSkill,
  ExecutionLogRow,
  RunDetail,
  TemplateBinding,
  TemplateSummary,
  WorkflowRow,
} from './types.js';

const WORKFLOWS = ['workflows'] as const;
const workflowKey = (id: string) => ['workflow', id] as const;
const runsKey = (workflowId: string) => ['workflow', workflowId, 'runs'] as const;
const runKey = (runId: string) => ['run', runId] as const;
const runLogsKey = (runId: string, nodeName?: string) =>
  nodeName ? (['run', runId, 'logs', nodeName] as const) : (['run', runId, 'logs'] as const);

export function useWorkflows() {
  return useQuery({
    queryKey: WORKFLOWS,
    queryFn: () => api.get<WorkflowRow[]>('/workflows'),
  });
}

export function useWorkflow(id: string | undefined) {
  return useQuery({
    queryKey: id ? workflowKey(id) : ['workflow', 'none'],
    queryFn: () => api.get<WorkflowRow>(`/workflows/${id!}`),
    enabled: !!id,
  });
}

export function useCreateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description?: string; definition?: WorkflowDefinition }) =>
      api.post<WorkflowRow>('/workflows', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: WORKFLOWS }),
  });
}

export function useUpdateWorkflow(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Pick<WorkflowRow, 'name' | 'description' | 'definition' | 'isActive'>>) =>
      api.put<WorkflowRow>(`/workflows/${id}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: WORKFLOWS });
      void qc.invalidateQueries({ queryKey: workflowKey(id) });
    },
  });
}

export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/workflows/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: WORKFLOWS }),
  });
}

export function useManualRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      workflowId: string;
      body?: { issue?: { id: string; key: string; title: string; url: string }; actor?: string };
    }) => api.post<{ id: string }>(`/workflows/${args.workflowId}/run`, args.body ?? {}),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: runsKey(vars.workflowId) });
      void qc.invalidateQueries({ queryKey: WORKFLOWS });
    },
  });
}

export function useRun(runId: string | undefined) {
  return useQuery({
    queryKey: runId ? runKey(runId) : ['run', 'none'],
    queryFn: () => api.get<RunDetail>(`/runs/${runId!}`),
    enabled: !!runId,
    refetchInterval: (q) => {
      // Socket.IO drives most live updates; this poll is a coarse fallback
      // so node-level rows refresh even if a frame was dropped.
      const data = q.state.data as RunDetail | undefined;
      return data && (data.status === 'PENDING' || data.status === 'RUNNING') ? 15000 : false;
    },
  });
}

export function useRunLogs(runId: string | undefined, nodeName?: string) {
  return useQuery({
    queryKey: runId ? runLogsKey(runId, nodeName) : ['run', 'none', 'logs'],
    queryFn: () =>
      api.get<ExecutionLogRow[]>(
        `/runs/${runId!}/logs${nodeName ? `/${encodeURIComponent(nodeName)}` : ''}`,
      ),
    enabled: !!runId,
  });
}

export function useCancelRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => api.post<RunDetail>(`/runs/${runId}/cancel`),
    onSuccess: (_, runId) => qc.invalidateQueries({ queryKey: runKey(runId) }),
  });
}

export function useCredentials() {
  return useQuery({
    queryKey: ['credentials'],
    queryFn: () => api.get<CredentialRow[]>('/credentials'),
  });
}

export function useCreateCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      platform: CredentialRow['platform'];
      name: string;
      secret: string;
      metadata?: Record<string, unknown>;
    }) =>
      api.post<{ id: string; name: string; platform: CredentialRow['platform'] }>(
        '/credentials',
        body,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credentials'] }),
  });
}

export function useUpdateCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      id: string;
      body: { name?: string; secret?: string; metadata?: Record<string, unknown> };
    }) => api.put<{ id: string }>(`/credentials/${args.id}`, args.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credentials'] }),
  });
}

export function useDeleteCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/credentials/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credentials'] }),
  });
}

const connectionsKey = (workflowId: string) =>
  ['workflow', workflowId, 'connections'] as const;

export function useConnections(workflowId: string | undefined) {
  return useQuery({
    queryKey: workflowId ? connectionsKey(workflowId) : ['workflow', 'none', 'connections'],
    queryFn: () => api.get<ConnectionRow[]>(`/workflows/${workflowId!}/connections`),
    enabled: !!workflowId,
  });
}

export function useCreateConnection(workflowId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      alias: string;
      credentialId: string;
      owner?: string;
      repo?: string;
      webhookSecret?: string;
    }) =>
      api.post<{ id: string; alias: string; credentialId: string }>(
        `/workflows/${workflowId}/connections`,
        body,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: connectionsKey(workflowId) }),
  });
}

export function useUpdateConnection(workflowId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      connectionId: string;
      body: {
        alias?: string;
        credentialId?: string;
        owner?: string;
        repo?: string;
        webhookSecret?: string;
      };
    }) =>
      api.put<{ id: string }>(
        `/workflows/${workflowId}/connections/${args.connectionId}`,
        args.body,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: connectionsKey(workflowId) }),
  });
}

export function useDeleteConnection(workflowId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) =>
      api.delete<void>(`/workflows/${workflowId}/connections/${connectionId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: connectionsKey(workflowId) }),
  });
}

export function useIntrospectMcp() {
  return useMutation({
    mutationFn: (body: { transport: McpTransport }) =>
      api.post<DiscoveredTool[]>('/mcp/introspect', body),
  });
}

export function useSkills() {
  return useQuery({
    queryKey: ['skills'],
    queryFn: () => api.get<DiscoveredSkill[]>('/skills'),
  });
}

export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<TemplateSummary[]>('/templates'),
  });
}

export function useCreateFromTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      templateId: string;
      bindings: Record<string, TemplateBinding>;
    }) =>
      api.post<CreatedFromTemplate>(`/workflows/from-template/${args.templateId}`, {
        bindings: args.bindings,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: WORKFLOWS }),
  });
}

export { runKey, runLogsKey };
