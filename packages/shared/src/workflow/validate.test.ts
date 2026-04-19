import { describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from './definition';
import { validateWorkflowDefinition } from './validate';

function baseDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    trigger: {
      platform: 'github',
      connectionId: 'conn_1',
      mode: { kind: 'webhook', event: 'issues.opened', active: true },
      filters: [],
    },
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
    workspace: { kind: 'ticket-branch', connectionId: 'conn_1' } as const,
  };
}

describe('validateWorkflowDefinition', () => {
  it('passes a ticket-branch workflow with a polling trigger', () => {
    const def = baseDefinition({
      nodes: [ticketBranchNode()],
      trigger: {
        platform: 'github',
        connectionId: 'conn_1',
        mode: { kind: 'polling', intervalSec: 60, active: true },
        filters: [{ field: 'status', op: 'eq', value: 'Dev' }],
        board: { ownerType: 'org', owner: 'acme', number: 1 },
      },
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
      trigger: {
        platform: 'github',
        connectionId: 'conn_1',
        mode: { kind: 'webhook', event: 'board.column.changed', active: true },
        filters: [],
        board: { ownerType: 'org', owner: 'acme', number: 1 },
      },
    });
    const issues = validateWorkflowDefinition(def);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('ticket-branch-rejects-board-column-webhook');
    expect(issues[0]!.nodeName).toBe('Worker');
  });

  it('rejects a ticket-branch workflow with an unsupported webhook event', () => {
    const def = baseDefinition({
      nodes: [ticketBranchNode()],
      trigger: {
        platform: 'github',
        connectionId: 'conn_1',
        mode: { kind: 'webhook', event: 'push', active: true },
        filters: [],
      },
    });
    const issues = validateWorkflowDefinition(def);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('ticket-branch-requires-issue-trigger');
  });

  it('leaves non-ticket-branch workflows alone', () => {
    const def = baseDefinition({
      trigger: {
        platform: 'github',
        connectionId: 'conn_1',
        mode: { kind: 'webhook', event: 'board.column.changed', active: true },
        filters: [],
        board: { ownerType: 'org', owner: 'acme', number: 1 },
      },
    });
    expect(validateWorkflowDefinition(def)).toEqual([]);
  });
});
