import { describe, expect, it } from 'vitest';
import type { TriggerEvent } from '../trigger/event';
import type { WorkflowDefinition } from './definition';
import { isTicketBranchWorkflow, ticketLockFor } from './identity';

// The functions under test only inspect `triggers.length`, `nodes.length`, and
// `trigger.issue?.key`, so fixtures carry just enough shape to set those.
function makeDefinition(triggerCount: number, nodeCount: number): WorkflowDefinition {
  return {
    triggers: Array.from(
      { length: triggerCount },
      () => ({}),
    ) as unknown as WorkflowDefinition['triggers'],
    nodes: Array.from({ length: nodeCount }, () => ({})) as unknown as WorkflowDefinition['nodes'],
    edges: [],
    mcpServers: [],
    ui: {} as WorkflowDefinition['ui'],
  };
}

function makeTrigger(issueKey?: string): TriggerEvent {
  return {
    source: 'github',
    mode: 'webhook',
    event: 'issues.opened',
    payload: {},
    ...(issueKey
      ? {
          issue: {
            id: 'I_kwDOABC',
            key: issueKey,
            title: 'Fix the thing',
            url: 'https://github.com/acme/repo/issues/42',
          },
        }
      : {}),
  } as TriggerEvent;
}

describe('isTicketBranchWorkflow', () => {
  it('is true when there is at least one trigger and one node', () => {
    expect(isTicketBranchWorkflow(makeDefinition(1, 1))).toBe(true);
  });

  it('is false when triggers is empty', () => {
    expect(isTicketBranchWorkflow(makeDefinition(0, 1))).toBe(false);
  });

  it('is false when nodes is empty (incomplete draft)', () => {
    expect(isTicketBranchWorkflow(makeDefinition(1, 0))).toBe(false);
  });
});

describe('ticketLockFor', () => {
  it('returns undefined when the workflow is not ticket-branch (no nodes)', () => {
    const definition = makeDefinition(1, 0);
    expect(ticketLockFor(definition, 'wf_123', makeTrigger('42'))).toBeUndefined();
  });

  it('returns undefined when the TriggerEvent carries no issue.key', () => {
    const definition = makeDefinition(1, 1);
    expect(ticketLockFor(definition, 'wf_123', makeTrigger())).toBeUndefined();
  });

  it('returns { workflowId, ticketKey } from issue.key when ticket-branch and key present', () => {
    const definition = makeDefinition(1, 1);
    expect(ticketLockFor(definition, 'wf_123', makeTrigger('PROJ-123'))).toEqual({
      workflowId: 'wf_123',
      ticketKey: 'PROJ-123',
    });
  });
});
