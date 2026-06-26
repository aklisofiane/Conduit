import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TriggerEvent } from '@conduit/shared';
import { cronFireActivity } from './cron-fire';

/**
 * The whole cron tick in one place: re-read config, gate on
 * `isActive` / trigger-type, parse the connection scope, derive the repo for
 * github vs gitlab, build the `cron.fired` `TriggerEvent`, and map
 * `startAgentRun`'s discriminated result into a `CronFireResult`.
 *
 * Real `@conduit/shared` zod schemas run (`workflowDefinitionSchema`,
 * `connectionScopeSchema`, `expectScopeKind`, `splitProjectPath`); only the
 * I/O edges (prisma + `./start-agent-run`) are mocked at the module boundary.
 */

const { workflowFindUnique, connectionFindUnique, startAgentRun } = vi.hoisted(() => ({
  workflowFindUnique: vi.fn(),
  connectionFindUnique: vi.fn(),
  startAgentRun: vi.fn(),
}));

vi.mock('../runtime/prisma', () => ({
  prisma: () => ({
    workflow: { findUnique: workflowFindUnique },
    connection: { findUnique: connectionFindUnique },
  }),
}));

vi.mock('./start-agent-run', () => ({ startAgentRun }));

const CRON_TRIGGER = {
  id: 't',
  name: 'T',
  platform: 'github',
  connectionId: 'conn_1',
  type: 'cron',
  cron: '0 9 * * *',
  timezone: 'America/Los_Angeles',
  branch: 'main',
};

function definitionWith(trigger: object) {
  return {
    triggers: [trigger],
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
}

function workflowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wf_1',
    orgId: 'org_1',
    isActive: true,
    temporalSlug: 'shop',
    definition: definitionWith(CRON_TRIGGER),
    ...overrides,
  };
}

describe('cronFireActivity', () => {
  beforeEach(() => {
    workflowFindUnique.mockResolvedValue(workflowRow());
    connectionFindUnique.mockResolvedValue({
      id: 'conn_1',
      scope: { kind: 'github_repo', owner: 'acme', repo: 'shop' },
    });
    startAgentRun.mockResolvedValue({ status: 'started', runId: 'run_1' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('skips an inactive workflow without starting a run', async () => {
    workflowFindUnique.mockResolvedValue(workflowRow({ isActive: false }));

    const result = await cronFireActivity({ workflowId: 'wf_1' });

    expect(result).toEqual({ workflowId: 'wf_1', skipReason: 'inactive', startedRunId: null });
    expect(startAgentRun).not.toHaveBeenCalled();
  });

  it('skips when the first trigger is not a cron trigger', async () => {
    workflowFindUnique.mockResolvedValue(
      workflowRow({
        definition: definitionWith({
          id: 't',
          name: 'T',
          platform: 'github',
          connectionId: 'conn_1',
          type: 'issues',
          intervalSec: 60,
          filters: [],
        }),
      }),
    );

    const result = await cronFireActivity({ workflowId: 'wf_1' });

    expect(result).toEqual({ workflowId: 'wf_1', skipReason: 'not-cron', startedRunId: null });
    expect(startAgentRun).not.toHaveBeenCalled();
  });

  it('throws when the workflow is missing', async () => {
    workflowFindUnique.mockResolvedValue(null);

    await expect(cronFireActivity({ workflowId: 'wf_1' })).rejects.toThrow('Workflow wf_1 not found');
    expect(startAgentRun).not.toHaveBeenCalled();
  });

  it('throws when the referenced connection is missing', async () => {
    connectionFindUnique.mockResolvedValue(null);

    await expect(cronFireActivity({ workflowId: 'wf_1' })).rejects.toThrow(
      'cron trigger references unknown connection conn_1',
    );
    expect(startAgentRun).not.toHaveBeenCalled();
  });

  it('builds the cron.fired event from a github_repo scope', async () => {
    await cronFireActivity({ workflowId: 'wf_1' });

    expect(startAgentRun).toHaveBeenCalledOnce();
    const params = startAgentRun.mock.calls[0]![0];
    expect(params.workflowId).toBe('wf_1');
    expect(params.orgId).toBe('org_1');
    expect(params.slug).toBe('shop');
    expect(params.logLabel).toBe('cronFireActivity');

    const event: TriggerEvent = params.triggerEvent;
    expect(event).toEqual({
      source: 'github',
      mode: 'scheduled',
      event: 'cron.fired',
      payload: {
        cron: '0 9 * * *',
        timezone: 'America/Los_Angeles',
        branch: 'main',
      },
      repo: { owner: 'acme', name: 'shop' },
    });
  });

  it('derives the repo from a gitlab_project scope via splitProjectPath', async () => {
    workflowFindUnique.mockResolvedValue(
      workflowRow({
        definition: definitionWith({ ...CRON_TRIGGER, platform: 'gitlab' }),
      }),
    );
    connectionFindUnique.mockResolvedValue({
      id: 'conn_1',
      scope: { kind: 'gitlab_project', projectPath: 'group/subgroup/api' },
    });

    await cronFireActivity({ workflowId: 'wf_1' });

    const event: TriggerEvent = startAgentRun.mock.calls[0]![0].triggerEvent;
    expect(event.source).toBe('gitlab');
    expect(event.repo).toEqual({ owner: 'group/subgroup', name: 'api' });
  });

  it('throws when a gitlab platform carries a non-gitlab scope kind', async () => {
    workflowFindUnique.mockResolvedValue(
      workflowRow({
        definition: definitionWith({ ...CRON_TRIGGER, platform: 'gitlab' }),
      }),
    );
    // scope is github_repo (from beforeEach) — expectScopeKind must reject it.

    await expect(cronFireActivity({ workflowId: 'wf_1' })).rejects.toThrow(
      'Expected connection scope kind "gitlab_project"',
    );
    expect(startAgentRun).not.toHaveBeenCalled();
  });

  it('maps a started result to the run id', async () => {
    startAgentRun.mockResolvedValue({ status: 'started', runId: 'run_42' });

    const result = await cronFireActivity({ workflowId: 'wf_1' });

    expect(result).toEqual({ workflowId: 'wf_1', startedRunId: 'run_42' });
  });

  it('maps a duplicate result to a null run with a duplicate marker', async () => {
    startAgentRun.mockResolvedValue({ status: 'duplicate' });

    const result = await cronFireActivity({ workflowId: 'wf_1' });

    expect(result).toEqual({ workflowId: 'wf_1', startedRunId: null, error: 'duplicate' });
  });

  it('rethrows on an error result so the activity retry policy applies', async () => {
    startAgentRun.mockResolvedValue({ status: 'error', runId: 'run_1', error: 'temporal down' });

    await expect(cronFireActivity({ workflowId: 'wf_1' })).rejects.toThrow('temporal down');
  });
});
