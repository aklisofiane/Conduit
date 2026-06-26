import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DiscoveredTool, McpTransport, WorkflowDefinition } from '@conduit/shared';
import type { TemplateFile } from '@conduit/shared/template';
import type { EnsureLabelResult } from '@conduit/shared/label';
import type {
  ProjectBoardSummary,
  RepoLabel,
  RepositorySummary,
  GitlabProjectSummary,
  ViewerOrgEntry,
} from '@conduit/shared/platform';
import { api } from './client.js';
import { makeDefaultTrigger } from '../lib/trigger-defaults.js';
import type {
  AgentPreset,
  ConnectionAnalysis,
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
      connectionId?: string;
      platform?: 'github' | 'gitlab';
    }) => {
      const { connectionId, platform: plat, ...rest } = body;
      if (connectionId && rest.triggerType && !rest.definition) {
        const id = `trigger_${Math.random().toString(36).slice(2, 10)}`;
        const name = 'Trigger1';
        const trigger = makeDefaultTrigger(rest.triggerType, {
          id,
          name,
          platform: plat ?? 'github',
          connectionId,
        });
        rest.definition = {
          triggers: [trigger],
          nodes: [],
          edges: [],
          mcpServers: [],
          ui: { nodePositions: { [name]: { x: 80, y: 120 } }, viewport: { x: 0, y: 0, zoom: 1 } },
        };
      }
      return api.post<WorkflowRow>('/workflows', rest);
    },
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

/**
 * Rerun a FAILED run. The API replays the original trigger and returns the
 * new run — or an empty body (`undefined`) when a newer run for the same
 * ticket is already in flight (ticket-branch dedup). The caller navigates to
 * the new run on a truthy result and surfaces the dedup case otherwise.
 */
export function useRerunRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      api.post<{ id: string; workflowId: string } | undefined>(`/runs/${runId}/rerun`),
    onSuccess: (run) => {
      if (run) qc.invalidateQueries({ queryKey: runsKey(run.workflowId) });
    },
  });
}

export function useCredentials() {
  return useQuery({
    queryKey: ['credentials'],
    queryFn: () => api.get<CredentialRow[]>('/credentials'),
    staleTime: 60_000,
  });
}

export function useCreateCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      platform: CredentialRow['platform'];
      name: string;
      secret: string;
      hostUrl?: string;
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
    staleTime: 60_000,
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

const connectionAnalysisKey = (connectionId: string) =>
  ['connection-analysis', connectionId] as const;

/**
 * Poll a connection's repo-analysis row. Returns `null` when the connection
 * has never been analyzed. Refetches every 2.5s while the analysis is in
 * flight (PENDING/ANALYZING) and stops once it settles (READY/FAILED), mirroring
 * the conditional-`refetchInterval` pattern in `useRun`.
 */
export function useConnectionAnalysis(connectionId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: connectionId ? connectionAnalysisKey(connectionId) : ['connection-analysis', 'none'],
    queryFn: () => api.get<ConnectionAnalysis | null>(`/connections/${connectionId!}/analysis`),
    enabled: enabled && !!connectionId,
    refetchInterval: (q) => {
      const data = q.state.data as ConnectionAnalysis | null | undefined;
      return data && (data.status === 'PENDING' || data.status === 'ANALYZING') ? 2500 : false;
    },
  });
}

/**
 * Kick off a repo analysis for a connection. Invalidates the analysis query so
 * polling immediately picks up the freshly-created PENDING row.
 */
export function useStartAnalysis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) =>
      api.post<{ analysisId: string }>(`/connections/${connectionId}/analyze`),
    onSuccess: (_res, connectionId) =>
      qc.invalidateQueries({ queryKey: connectionAnalysisKey(connectionId) }),
  });
}

/**
 * Mark an analysis's suggestions as imported. Invalidates the analysis query so
 * the gallery / pill reflect the imported state across reloads, preventing a
 * re-opened gallery from silently re-importing the same workflows.
 */
export function useMarkAnalysisImported(connectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (analysisId: string) =>
      api.post<void>(`/connections/${connectionId}/analysis/${analysisId}/imported`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: connectionAnalysisKey(connectionId) }),
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

export function useListViewerRepos(args: {
  credentialId: string;
  enabled: boolean;
}) {
  const { credentialId, enabled } = args;
  return useQuery({
    queryKey: ['repos', credentialId] as const,
    queryFn: () =>
      api.post<RepositorySummary[] | GitlabProjectSummary[]>('/trigger/list-viewer-repos', {
        credentialId,
      }),
    enabled: enabled && !!credentialId,
    staleTime: 30_000,
    retry: false,
  });
}

export function useListViewerOrgs(args: {
  credentialId: string;
  enabled: boolean;
}) {
  const { credentialId, enabled } = args;
  return useQuery({
    queryKey: ['viewer-orgs', credentialId] as const,
    queryFn: () =>
      api.post<ViewerOrgEntry[]>('/trigger/list-viewer-orgs', { credentialId }),
    enabled: enabled && !!credentialId,
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

/**
 * Idempotently ensure labels exist on a connection's repo/project. Used by
 * both the trigger-panel inline "create label" action (one name) and the
 * connection-time prompt (the selected set). Invalidates the labels query on
 * success so any open dropdown re-resolves and an unmatched value clears.
 */
export function useEnsureRepoLabels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { connectionId: string; names: string[] }) =>
      api.post<EnsureLabelResult[]>('/trigger/ensure-labels', args),
    onSuccess: (_res, { connectionId }) =>
      qc.invalidateQueries({ queryKey: ['labels', connectionId] }),
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
    staleTime: 60_000,
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

export function useImportTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      template: TemplateFile;
      bindings: Record<string, TemplateBinding>;
    }) =>
      api.post<CreatedFromTemplate>('/workflows/import', {
        template: args.template,
        bindings: args.bindings,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: WORKFLOWS }),
  });
}

export { runKey, runLogsKey };
