import { ZodError } from 'zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveWorkspaces, workflowDefinitionSchema } from '@conduit/shared';
import type { WorkflowDefinition } from '@conduit/shared';
import { loadGraphActivity } from './load-graph';

/**
 * loadGraphActivity is the workflow's entry activity: it Zod-parses the stored
 * `Workflow.definition` (catching DB/schema drift) and runs `deriveWorkspaces`
 * over graph topology before the Temporal workflow topo-sorts. The
 * agent-workflow integration test hand-builds a LoadedGraph and never
 * exercises this real parse+derive path, so a schema change or a
 * deriveWorkspaces regression would slip through. Only prisma is mocked; the
 * real @conduit/shared schema + deriveWorkspaces run.
 */

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock('../runtime/prisma', () => ({
  prisma: () => ({ workflow: { findUnique } }),
}));

function agentNode(name: string) {
  return {
    id: `agent-${name.toLowerCase()}`,
    name,
    provider: 'claude' as const,
    model: 'claude-sonnet-5',
    instructions: 'do work',
    mcpServers: [],
    skills: [],
    webSearch: false,
  };
}

/**
 * A realistic chain: an issues webhook trigger -> Seed -> Dev.
 *   Seed has a trigger upstream  -> ticket-branch
 *   Dev  has a single agent upstream (Seed) -> inherit { fromNode: 'Seed' }
 */
function chainDefinition(): WorkflowDefinition {
  return {
    triggers: [
      {
        id: 'trigger-1',
        name: 'Trigger1',
        platform: 'github',
        connectionId: 'conn_1',
        type: 'webhook',
        event: 'issues.opened',
        filters: [],
      },
    ],
    nodes: [agentNode('Seed'), agentNode('Dev')],
    edges: [
      { from: 'Trigger1', to: 'Seed' },
      { from: 'Seed', to: 'Dev' },
    ],
    mcpServers: [],
    ui: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
  } as WorkflowDefinition;
}

function workflowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wf_1',
    name: 'Ship It',
    orgId: 'org_1',
    definition: chainDefinition(),
    ...overrides,
  };
}

describe('loadGraphActivity', () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws when the workflow row is missing', async () => {
    findUnique.mockResolvedValue(null);
    await expect(loadGraphActivity('wf_missing')).rejects.toThrow('Workflow wf_missing not found');
  });

  it('copies workflowId/workflowName/orgId straight from the Workflow row', async () => {
    findUnique.mockResolvedValue(workflowRow());
    const graph = await loadGraphActivity('wf_1');
    expect(graph.workflowId).toBe('wf_1');
    expect(graph.workflowName).toBe('Ship It');
    expect(graph.orgId).toBe('org_1');
  });

  it('derives node workspaces over topology: trigger upstream -> ticket-branch, single agent upstream -> inherit', async () => {
    findUnique.mockResolvedValue(workflowRow());
    const graph = await loadGraphActivity('wf_1');

    const seed = graph.nodes.find((n) => n.name === 'Seed');
    const dev = graph.nodes.find((n) => n.name === 'Dev');

    // Seed's only upstream is the issues webhook trigger.
    expect(seed?.workspace).toEqual({ kind: 'ticket-branch' });
    // Dev inherits from its single agent upstream, Seed.
    expect(dev?.workspace).toEqual({ kind: 'inherit', fromNode: 'Seed' });
  });

  it('returns nodes/triggers/edges/mcpServers equal to the real parse+derive output', async () => {
    findUnique.mockResolvedValue(workflowRow());
    const graph = await loadGraphActivity('wf_1');

    const expected = deriveWorkspaces(workflowDefinitionSchema.parse(chainDefinition()));
    expect(graph.nodes).toEqual(expected.nodes);
    expect(graph.triggers).toEqual(expected.triggers);
    expect(graph.edges).toEqual(expected.edges);
    expect(graph.mcpServers).toEqual(expected.mcpServers);
  });

  it('throws a ZodError on a definition that fails the schema (no partial graph)', async () => {
    // An edge whose `to` references a trigger is rejected by the schema's
    // superRefine — the activity must surface that, not return a half-derived graph.
    findUnique.mockResolvedValue(
      workflowRow({
        definition: {
          ...chainDefinition(),
          edges: [{ from: 'Trigger1', to: 'Trigger1' }],
        },
      }),
    );
    await expect(loadGraphActivity('wf_1')).rejects.toBeInstanceOf(ZodError);
  });
});
