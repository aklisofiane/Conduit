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
    mode: { kind: 'webhook', event: 'issues.opened' },
    filters: [],
    ...overrides,
  };
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
  it('passes a workflow with a polling trigger', () => {
    const def = baseDefinition({
      nodes: [agentNode()],
      triggers: [
        trigger({
          mode: { kind: 'polling', intervalSec: 60, scope: 'issues' },
          filters: [{ field: 'status', value: 'Dev' }],
          board: { ownerType: 'org', owner: 'acme', number: 1 },
        }),
      ],
    });
    expect(validateWorkflowDefinition(def)).toEqual([]);
  });

  it('passes a workflow with issues.opened webhook', () => {
    const def = baseDefinition({ nodes: [agentNode()] });
    expect(validateWorkflowDefinition(def)).toEqual([]);
  });

  it('passes a workflow with pull_request.opened webhook', () => {
    const def = baseDefinition({
      nodes: [agentNode()],
      triggers: [trigger({ mode: { kind: 'webhook', event: 'pull_request.opened' } })],
    });
    expect(validateWorkflowDefinition(def)).toEqual([]);
  });

  it('rejects a workflow whose webhook event carries no issue/PR identifier', () => {
    const def = baseDefinition({
      nodes: [agentNode()],
      triggers: [
        trigger({
          mode: { kind: 'webhook', event: 'board.column.changed' },
          board: { ownerType: 'org', owner: 'acme', number: 1 },
        }),
      ],
    });
    const issues = validateWorkflowDefinition(def);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('trigger-requires-issue-or-pr');
    expect(issues[0]!.nodeName).toBe('Trigger1');
  });

  it('rejects an unsupported webhook event', () => {
    const def = baseDefinition({
      nodes: [agentNode()],
      triggers: [trigger({ mode: { kind: 'webhook', event: 'push' } })],
    });
    const issues = validateWorkflowDefinition(def);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('trigger-requires-issue-or-pr');
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
});

describe('workflowDefinitionSchema', () => {
  it('rejects zero triggers', () => {
    const result = workflowDefinitionSchema.safeParse({
      ...baseDefinition(),
      triggers: [],
    });
    expect(result.success).toBe(false);
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
});
