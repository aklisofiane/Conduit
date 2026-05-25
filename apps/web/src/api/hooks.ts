import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DiscoveredTool, McpTransport, WorkflowDefinition } from '@conduit/shared';
import type { ProjectBoardSummary, RepoLabel } from '@conduit/shared/platform';
import { api } from './client.js';
import type {
  AgentPreset,
  ConnectionRow,
  ConnectionScope,
  ConnectionScopeKind,
  CreatedFromTemplate,
  CredentialRow,
  DiscoveredSkill,
  ExecutionLogRow,
  ProviderConfig,
  RunDetail,
  TemplateBinding,
  TemplateSummary,
  WorkflowRow,
  WorkflowRunListItem,
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
    mutationFn: (body: {
      name: string;
      description?: string;
      definition?: WorkflowDefinition;
      triggerType?: 'issues' | 'pull_requests' | 'cron';
    }) => api.post<WorkflowRow>('/workflows', body),
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

export function useDuplicateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<WorkflowRow>(`/workflows/${id}/duplicate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: WORKFLOWS }),
  });
}

export function useWorkflowRuns(workflowId: string | undefined, limit = 50) {
  return useQuery({
    queryKey: workflowId ? runsKey(workflowId) : ['workflow', 'none', 'runs'],
    queryFn: () =>
      api.get<WorkflowRunListItem[]>(`/workflows/${workflowId!}/runs?limit=${limit}`),
    enabled: !!workflowId,
    refetchInterval: (q) => {
      const data = q.state.data as WorkflowRunListItem[] | undefined;
      const inFlight = data?.some((r) => r.status === 'PENDING' || r.status === 'RUNNING');
      return inFlight ? 5000 : 15000;
    },
  });
}

export function useRun(runId: string | undefined) {
  return useQuery({
    queryKey: runId ? runKey(runId) : ['run', 'none'],
    queryFn: () => api.get<RunDetail>(`/runs/${runId!}`),
    enabled: !!runId,
    refetchInterval: (q) => {
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

const PROVIDER_CONFIGS = ['provider-configs'] as const;

export function useProviderConfigs() {
  return useQuery({
    queryKey: PROVIDER_CONFIGS,
    queryFn: () => api.get<ProviderConfig[]>('/provider-configs'),
  });
}

export function useCreateProviderConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      providerId: ProviderConfig['providerId'];
      apiKey: string;
      baseUrl?: string;
    }) => api.post<ProviderConfig>('/provider-configs', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROVIDER_CONFIGS }),
  });
}

export function useUpdateProviderConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      id: string;
      body: { apiKey?: string; baseUrl?: string | null };
    }) => api.put<ProviderConfig>(`/provider-configs/${args.id}`, args.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROVIDER_CONFIGS }),
  });
}

export function useDeleteProviderConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/provider-configs/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROVIDER_CONFIGS }),
  });
}

const CONNECTIONS = ['connections'] as const;

export interface ConnectionsFilter {
  platform?: CredentialRow['platform'];
  scopeKind?: ConnectionScopeKind;
}

export function useConnections(filter: ConnectionsFilter = {}) {
  const params = new URLSearchParams();
  if (filter.platform) params.set('platform', filter.platform);
  if (filter.scopeKind) params.set('scopeKind', filter.scopeKind);
  const qs = params.toString();
  return useQuery({
    queryKey: [...CONNECTIONS, filter.platform ?? null, filter.scopeKind ?? null] as const,
    queryFn: () => api.get<ConnectionRow[]>(`/connections${qs ? `?${qs}` : ''}`),
  });
}

export function useCreateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { credentialId: string; name: string; scope: ConnectionScope }) =>
      api.post<ConnectionRow>('/connections', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: CONNECTIONS }),
  });
}

export function useUpdateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      id: string;
      body: { credentialId?: string; name?: string; scope?: ConnectionScope };
    }) => api.patch<ConnectionRow>(`/connections/${args.id}`, args.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: CONNECTIONS }),
  });
}

export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/connections/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: CONNECTIONS }),
  });
}

export function useSetWebhookSecret(workflowId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (secret: string) =>
      api.put<{ id: string }>(`/workflows/${workflowId}/webhook-secret`, { secret }),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowKey(workflowId) }),
  });
}

export function useClearWebhookSecret(workflowId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<void>(`/workflows/${workflowId}/webhook-secret`),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowKey(workflowId) }),
  });
}

export function useIntrospectMcp() {
  return useMutation({
    mutationFn: (body: {
      transport: McpTransport;
      workflowId?: string;
      connectionId?: string;
    }) => api.post<DiscoveredTool[]>('/mcp/introspect', body),
  });
}

export function useListProjectBoards(
  args: { ownerType: 'user' | 'org'; owner: string; enabled: boolean } & (
    | { connectionId: string; credentialId?: undefined }
    | { credentialId: string; connectionId?: undefined }
  ),
) {
  const { ownerType, owner, enabled, connectionId, credentialId } = args;
  const tokenId = connectionId ?? credentialId ?? '';
  return useQuery({
    queryKey: ['project-boards', connectionId ?? null, credentialId ?? null, ownerType, owner] as const,
    queryFn: () =>
      api.post<ProjectBoardSummary[]>('/trigger/list-projects', {
        ...(connectionId ? { connectionId } : { credentialId }),
        ownerType,
        owner,
      }),
    enabled: enabled && !!tokenId && !!owner,
    staleTime: 30_000,
    retry: false,
  });
}

export function useListLabels(args: { connectionId: string; enabled: boolean }) {
  const { connectionId, enabled } = args;
  return useQuery({
    queryKey: ['labels', connectionId] as const,
    queryFn: () =>
      api.post<RepoLabel[]>('/trigger/list-labels', { connectionId }),
    enabled: enabled && !!connectionId,
    staleTime: 30_000,
    retry: false,
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

export function useAgentPresets() {
  return useQuery({
    queryKey: ['agent-presets'],
    queryFn: () => api.get<AgentPreset[]>('/agent-presets'),
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
