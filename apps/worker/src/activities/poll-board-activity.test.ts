import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectBoardItem } from '@conduit/shared/platform';
import { pollBoardActivity } from './poll-board';

/**
 * Activity-level resilience: body hydration is best-effort enrichment, not a
 * prerequisite for starting a workflow. A transient GitHub error inside
 * `hydrateGithubItemBodies` must not abort the whole poll cycle — workflows
 * for matching new items still have to start (degraded, without bodies)
 * rather than the tick becoming a complete miss. See issue #28.
 *
 * Real `@conduit/shared` schemas + matcher run; only the I/O edges (prisma,
 * temporal client, crypto, platform fetchers, log writer) are mocked.
 */

const {
  workflowFindUnique,
  connectionFindUnique,
  pollSnapshotUpsert,
  runCreate,
  runUpdate,
  runDelete,
  fetchRepositoryIssues,
  fetchRepositoryPullRequests,
  fetchProjectBoardItems,
  fetchGitlabProjectIssues,
  fetchGitlabProjectMergeRequests,
  hydrateGithubItemBodies,
  getTemporalClient,
  workflowStart,
} = vi.hoisted(() => ({
  workflowFindUnique: vi.fn(),
  connectionFindUnique: vi.fn(),
  pollSnapshotUpsert: vi.fn(),
  runCreate: vi.fn(),
  runUpdate: vi.fn(),
  runDelete: vi.fn(),
  fetchRepositoryIssues: vi.fn(),
  fetchRepositoryPullRequests: vi.fn(),
  fetchProjectBoardItems: vi.fn(),
  fetchGitlabProjectIssues: vi.fn(),
  fetchGitlabProjectMergeRequests: vi.fn(),
  hydrateGithubItemBodies: vi.fn(),
  getTemporalClient: vi.fn(),
  workflowStart: vi.fn(),
}));

vi.mock('../runtime/prisma', () => ({
  prisma: () => ({
    workflow: { findUnique: workflowFindUnique },
    connection: { findUnique: connectionFindUnique },
    pollSnapshot: { upsert: pollSnapshotUpsert },
    workflowRun: { create: runCreate, update: runUpdate, delete: runDelete },
  }),
}));

vi.mock('../runtime/temporal-client', () => ({ getTemporalClient }));

vi.mock('../runtime/log-writer', () => ({ writeSystemLog: vi.fn() }));

vi.mock('@conduit/shared/crypto', () => ({
  decryptSecret: () => 'gh-token',
  loadEncryptionKey: () => Buffer.alloc(32),
}));

vi.mock('@conduit/shared/platform', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchRepositoryIssues,
  fetchRepositoryPullRequests,
  fetchProjectBoardItems,
  fetchGitlabProjectIssues,
  fetchGitlabProjectMergeRequests,
  hydrateGithubItemBodies,
}));

const ISSUE_ITEM: ProjectBoardItem = {
  itemNodeId: 'PVTI_ISSUE_1',
  contentNodeId: 'I_1',
  contentType: 'Issue',
  contentKey: '42',
  contentTitle: 'Crash on save',
  contentUrl: 'https://github.com/acme/shop/issues/42',
  repo: { owner: 'acme', name: 'shop' },
  singleSelectValues: {},
  labels: [],
};

const DEFINITION = {
  triggers: [
    {
      id: 't',
      name: 'T',
      platform: 'github',
      connectionId: 'conn_1',
      type: 'issues',
      intervalSec: 60,
      filters: [],
    },
  ],
  nodes: [
    {
      id: 'agent-seed',
      name: 'Seed',
      provider: 'claude',
      model: 'stub',
      instructions: 'do work',
      mcpServers: [],
      skills: [],
      webSearch: false,
    },
  ],
  edges: [{ from: 'T', to: 'Seed' }],
  mcpServers: [],
  ui: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
};

describe('pollBoardActivity body-hydration resilience', () => {
  beforeEach(() => {
    workflowFindUnique.mockResolvedValue({
      id: 'wf_1',
      orgId: 'org_1',
      isActive: true,
      temporalSlug: null,
      definition: DEFINITION,
      pollSnapshot: null,
    });
    connectionFindUnique.mockResolvedValue({
      id: 'conn_1',
      scope: { kind: 'github_repo', owner: 'acme', repo: 'shop' },
      credential: { secret: 'enc', hostUrl: null },
    });
    fetchRepositoryIssues.mockResolvedValue([ISSUE_ITEM]);
    pollSnapshotUpsert.mockResolvedValue({});
    runCreate.mockResolvedValue({ id: 'run_1' });
    runUpdate.mockResolvedValue({});
    runDelete.mockResolvedValue({});
    workflowStart.mockResolvedValue({ firstExecutionRunId: 'temporal_run_1' });
    getTemporalClient.mockResolvedValue({ workflow: { start: workflowStart } });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('still starts workflows when hydration throws', async () => {
    hydrateGithubItemBodies.mockRejectedValue(new Error('GitHub 502'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await pollBoardActivity({ workflowId: 'wf_1' });

    // Hydration was attempted and failed, but the failure was swallowed.
    expect(hydrateGithubItemBodies).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('body hydration failed'));

    // The workflow still started for the matching new item — the whole point.
    expect(workflowStart).toHaveBeenCalledOnce();
    expect(result.startedRunIds).toEqual(['run_1']);
    expect(result.newCount).toBe(1);

    warn.mockRestore();
  });

  it('applies hydrated bodies on success', async () => {
    hydrateGithubItemBodies.mockResolvedValue(new Map([['I_1', 'Steps to reproduce']]));

    await pollBoardActivity({ workflowId: 'wf_1' });

    expect(workflowStart).toHaveBeenCalledOnce();
    const startArgs = workflowStart.mock.calls[0]![1].args[0];
    expect(startArgs.triggerEvent.issue.body).toBe('Steps to reproduce');
  });
});
