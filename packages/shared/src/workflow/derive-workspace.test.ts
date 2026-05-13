import { describe, expect, it } from 'vitest';
import type { TriggerConfig } from '../trigger/config';
import type { AgentConfig } from '../agent/index';
import { deriveWorkspaces } from './derive-workspace';
import type { WorkflowDefinition } from './definition';

const trigger: TriggerConfig = {
  id: 't',
  name: 'T',
  platform: 'github',
  connectionId: 'conn_1',
  type: 'webhook',
  event: 'issues.opened',
  filters: [],
};

function agent(name: string): AgentConfig {
  return {
    id: `agent-${name.toLowerCase()}`,
    name,
    provider: 'claude',
    model: 'stub',
    instructions: 'do work',
    mcpServers: [],
    skills: [],
    webSearch: false,
  };
}

function definition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    triggers: [trigger],
    nodes: [],
    edges: [],
    mcpServers: [],
    ui: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
    ...overrides,
  };
}

describe('deriveWorkspaces', () => {
  it('marks trigger-connected nodes as ticket-branch', () => {
    const def = definition({
      nodes: [agent('Seed')],
      edges: [{ from: 'T', to: 'Seed' }],
    });
    const out = deriveWorkspaces(def);
    expect(out.nodes[0]!.workspace).toEqual({ kind: 'ticket-branch' });
  });

  it('marks single-upstream nodes as inherit { fromNode }', () => {
    const def = definition({
      nodes: [agent('Seed'), agent('Worker')],
      edges: [
        { from: 'T', to: 'Seed' },
        { from: 'Seed', to: 'Worker' },
      ],
    });
    const out = deriveWorkspaces(def);
    expect(out.nodes[1]!.workspace).toEqual({ kind: 'inherit', fromNode: 'Seed' });
  });

  it('resolves the common ancestor for fan-in nodes (develop.json shape)', () => {
    // Trigger → Seed → {Dev, Tests, Docs} → QA. QA's upstreams are Dev,
    // Tests, Docs; their shared ancestor is Seed. The runtime merges parallel
    // siblings back into Seed's worktree, so QA inheriting from Seed reads
    // the merged result — this is the spec's load-bearing example.
    const def = definition({
      nodes: [agent('Seed'), agent('Dev'), agent('Tests'), agent('Docs'), agent('QA')],
      edges: [
        { from: 'T', to: 'Seed' },
        { from: 'Seed', to: 'Dev' },
        { from: 'Seed', to: 'Tests' },
        { from: 'Seed', to: 'Docs' },
        { from: 'Dev', to: 'QA' },
        { from: 'Tests', to: 'QA' },
        { from: 'Docs', to: 'QA' },
      ],
    });
    const out = deriveWorkspaces(def);
    const qa = out.nodes.find((n) => n.name === 'QA')!;
    expect(qa.workspace).toEqual({ kind: 'inherit', fromNode: 'Seed' });
  });

  it('preserves an existing workspace when one is already set (legacy round-trip)', () => {
    const seed = { ...agent('Seed'), workspace: { kind: 'inherit' as const, fromNode: 'X' } };
    const def = definition({
      nodes: [seed],
      edges: [{ from: 'T', to: 'Seed' }],
    });
    const out = deriveWorkspaces(def);
    expect(out.nodes[0]!.workspace).toEqual({ kind: 'inherit', fromNode: 'X' });
  });

  it('treats an orphan agent as ticket-branch (no upstream of any kind)', () => {
    const def = definition({
      nodes: [agent('Orphan')],
      edges: [],
    });
    const out = deriveWorkspaces(def);
    expect(out.nodes[0]!.workspace).toEqual({ kind: 'ticket-branch' });
  });

  it('picks the topo-latest common ancestor when several survive intersection', () => {
    // T → A → B → D
    // T → A → C → D
    // T → A      (also direct)
    // D's upstreams: {B, C}. Their ancestor sets both contain {A, T-root-not-agent}.
    // Direct shared ancestor: A (closest to D).
    const def = definition({
      nodes: [agent('A'), agent('B'), agent('C'), agent('D')],
      edges: [
        { from: 'T', to: 'A' },
        { from: 'A', to: 'B' },
        { from: 'A', to: 'C' },
        { from: 'B', to: 'D' },
        { from: 'C', to: 'D' },
      ],
    });
    const out = deriveWorkspaces(def);
    const d = out.nodes.find((n) => n.name === 'D')!;
    expect(d.workspace).toEqual({ kind: 'inherit', fromNode: 'A' });
  });
});
