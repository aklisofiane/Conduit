import { describe, expect, it } from 'vitest';
import type { TriggerConfig } from '../trigger/config';
import type { WorkflowDefinition } from './definition';
import { workflowDefinitionSchema } from './definition';
import { validateWorkflowDefinition } from './validate';

function trigger(overrides: Partial<TriggerConfig> = {}): TriggerConfig {
  return {
    id: 'trigger-1',
    name: 'Trigger1',
    platform: 'github',
    connectionId: 'conn_1',
    type: 'webhook',
    event: 'issues.opened',
    filters: [],
    ...overrides,
  } as TriggerConfig;
}

function baseDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    triggers: [trigger()],
    nodes: [],
    edges: [],
    mcpServers: [],
    ui: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
    ...overrides,
  };
}

function agentNode(name = 'Worker') {
  return {
    id: `agent-${name.toLowerCase()}`,
    name,
    provider: 'claude' as const,
    model: 'claude-sonnet-4-6',
    instructions: 'do work',
    mcpServers: [],
    skills: [],
    webSearch: false,
  };
}

describe('validateWorkflowDefinition', () => {
  it('passes a workflow with a polling board trigger that carries a board connection', () => {
    const def = baseDefinition({
      nodes: [agentNode()],
      triggers: [
        trigger({
          type: 'issues',
          intervalSec: 60,
          filters: [{ field: 'status', value: 'Dev' }],
          boardConnectionId: 'conn_board_1',
        }),
      ],
    });
    expect(validateWorkflowDefinition(def)).toEqual([]);
  });

  it('passes a workflow with issues.opened webhook (no board needed)', () => {
    const def = baseDefinition({ nodes: [agentNode()] });
    expect(validateWorkflowDefinition(def)).toEqual([]);
  });

  it('passes a workflow with pull_request.opened webhook', () => {
    const def = baseDefinition({
      nodes: [agentNode()],
      triggers: [trigger({ type: 'webhook', event: 'pull_request.opened' })],
    });
    expect(validateWorkflowDefinition(def)).toEqual([]);
  });

  it('rejects a workflow whose webhook event carries no issue/PR identifier', () => {
    const def = baseDefinition({
      nodes: [agentNode()],
      triggers: [
        trigger({
          type: 'webhook',
          event: 'board.column.changed',
          boardConnectionId: 'conn_board_1',
        }),
      ],
    });
    const issues = validateWorkflowDefinition(def);
    // board.column.changed is not on the issue/PR allowlist (today),
    // separate from board-connection-required.
    expect(issues.map((i) => i.code)).toContain('trigger-requires-issue-or-pr');
  });

  it('rejects an unsupported webhook event', () => {
    const def = baseDefinition({
      nodes: [agentNode()],
      triggers: [trigger({ type: 'webhook', event: 'push' })],
    });
    const issues = validateWorkflowDefinition(def);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('trigger-requires-issue-or-pr');
  });

  it('passes a polling PR trigger (no board ref — repo is implicit)', () => {
    const def = baseDefinition({
      nodes: [agentNode()],
      triggers: [
        trigger({
          type: 'pull_requests',
          intervalSec: 60,
          filters: [{ field: 'pr_state', value: 'draft' }],
        }),
      ],
    });
    expect(validateWorkflowDefinition(def)).toEqual([]);
  });

  it('rejects a workflow whose triggers reference different connections', () => {
    const def = baseDefinition({
      nodes: [agentNode()],
      triggers: [
        trigger({ id: 't1', name: 'T1', connectionId: 'conn_a' }),
        trigger({ id: 't2', name: 'T2', connectionId: 'conn_b' }),
      ],
    });
    const issues = validateWorkflowDefinition(def);
    expect(issues.map((i) => i.code)).toContain('triggers-must-share-connection');
  });

  it('rejects a board.column.changed webhook missing boardConnectionId (orthogonal to issue/PR rule)', () => {
    const def = baseDefinition({
      nodes: [agentNode()],
      triggers: [trigger({ type: 'webhook', event: 'board.column.changed' })],
    });
    const codes = validateWorkflowDefinition(def).map((i) => i.code);
    expect(codes).toContain('trigger-board-connection-required');
  });

  it('rejects a workflow whose triggers reference different boardConnectionIds', () => {
    const def = baseDefinition({
      nodes: [agentNode()],
      triggers: [
        trigger({
          id: 't1',
          name: 'T1',
          type: 'issues',
          intervalSec: 60,
          boardConnectionId: 'conn_board_a',
        }),
        trigger({
          id: 't2',
          name: 'T2',
          type: 'issues',
          intervalSec: 60,
          boardConnectionId: 'conn_board_b',
        }),
      ],
    });
    const issues = validateWorkflowDefinition(def);
    expect(issues.map((i) => i.code)).toContain('triggers-must-share-board-connection');
  });
});

describe('workflowDefinitionSchema', () => {
  it('accepts zero triggers (in-flight state during swap-by-delete)', () => {
    const result = workflowDefinitionSchema.safeParse({
      ...baseDefinition(),
      triggers: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects two triggers', () => {
    const result = workflowDefinitionSchema.safeParse({
      ...baseDefinition(),
      triggers: [trigger({ id: 't1', name: 'T1' }), trigger({ id: 't2', name: 'T2' })],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an edge whose `to` references a trigger', () => {
    const result = workflowDefinitionSchema.safeParse({
      ...baseDefinition(),
      edges: [{ from: 'Trigger1', to: 'Trigger1' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an edge whose `from` is unknown', () => {
    const result = workflowDefinitionSchema.safeParse({
      ...baseDefinition({ nodes: [agentNode('A')] }),
      edges: [{ from: 'Ghost', to: 'A' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a trigger->agent edge', () => {
    const result = workflowDefinitionSchema.safeParse({
      ...baseDefinition({ nodes: [agentNode('A')] }),
      edges: [{ from: 'Trigger1', to: 'A' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a name shared between trigger and agent', () => {
    const result = workflowDefinitionSchema.safeParse({
      ...baseDefinition({ nodes: [agentNode('Trigger1')] }),
    });
    expect(result.success).toBe(false);
  });

  it('rejects two nodes with the same id', () => {
    const dup = { ...agentNode('B'), id: agentNode('A').id };
    const result = workflowDefinitionSchema.safeParse({
      ...baseDefinition({ nodes: [agentNode('A'), dup] }),
    });
    expect(result.success).toBe(false);
  });

  it('rejects two nodes with the same name', () => {
    const dup = { ...agentNode('A'), id: 'agent-a2' };
    const result = workflowDefinitionSchema.safeParse({
      ...baseDefinition({ nodes: [agentNode('A'), dup] }),
    });
    expect(result.success).toBe(false);
  });
});
