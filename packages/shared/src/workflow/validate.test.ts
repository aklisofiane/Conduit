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

function ticketBranchNode(name = 'Worker') {
  return {
    id: `agent-${name.toLowerCase()}`,
    name,
    provider: 'claude' as const,
    model: 'claude-sonnet-4-6',
    instructions: 'do work',
    mcpServers: [],
    skills: [],
    webSearch: false,
    workspace: { kind: 'ticket-branch', connectionId: 'conn_1' } as const,
  };
}

describe('validateWorkflowDefinition', () => {
  it('passes a ticket-branch workflow with a polling trigger', () => {
    const def = baseDefinition({
      nodes: [ticketBranchNode()],
      triggers: [
        trigger({
          mode: { kind: 'polling', intervalSec: 60 },
          filters: [{ field: 'status', op: 'eq', value: 'Dev' }],
          board: { ownerType: 'org', owner: 'acme', number: 1 },
        }),
      ],
    });
    expect(validateWorkflowDefinition(def)).toEqual([]);
  });

  it('passes a ticket-branch workflow with issues.opened webhook', () => {
    const def = baseDefinition({ nodes: [ticketBranchNode()] });
    expect(validateWorkflowDefinition(def)).toEqual([]);
  });

  it('rejects a ticket-branch workflow with a board.column.changed webhook', () => {
    const def = baseDefinition({
      nodes: [ticketBranchNode()],
      triggers: [
        trigger({
          mode: { kind: 'webhook', event: 'board.column.changed' },
          board: { ownerType: 'org', owner: 'acme', number: 1 },
        }),
      ],
    });
    const issues = validateWorkflowDefinition(def);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('ticket-branch-rejects-board-column-webhook');
    expect(issues[0]!.nodeName).toBe('Worker');
  });

  it('rejects a ticket-branch workflow with an unsupported webhook event', () => {
    const def = baseDefinition({
      nodes: [ticketBranchNode()],
      triggers: [trigger({ mode: { kind: 'webhook', event: 'push' } })],
    });
    const issues = validateWorkflowDefinition(def);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('ticket-branch-requires-issue-trigger');
  });

  it('leaves non-ticket-branch workflows alone', () => {
    const def = baseDefinition({
      triggers: [
        trigger({
          mode: { kind: 'webhook', event: 'board.column.changed' },
          board: { ownerType: 'org', owner: 'acme', number: 1 },
        }),
      ],
    });
    expect(validateWorkflowDefinition(def)).toEqual([]);
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
      ...baseDefinition({ nodes: [ticketBranchNode('A')] }),
      edges: [{ from: 'Ghost', to: 'A' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a trigger->agent edge', () => {
    const result = workflowDefinitionSchema.safeParse({
      ...baseDefinition({ nodes: [ticketBranchNode('A')] }),
      edges: [{ from: 'Trigger1', to: 'A' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a name shared between trigger and agent', () => {
    const result = workflowDefinitionSchema.safeParse({
      ...baseDefinition({ nodes: [ticketBranchNode('Trigger1')] }),
    });
    expect(result.success).toBe(false);
  });
});
