import { describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from '@conduit/shared';
import { remapConnectionIds } from './remap-connection-ids';

const baseDefinition = {
  triggers: [
    {
      id: 't1',
      name: 'Trigger',
      platform: 'github',
      connectionId: 'old_conn_a',
      mode: { kind: 'webhook', event: 'issues.opened' },
      filters: [],
    },
  ],
  nodes: [
    {
      name: 'Repo',
      workspace: { kind: 'repo-clone', connectionId: 'old_conn_a' },
    },
    {
      name: 'Ticket',
      workspace: { kind: 'ticket-branch', connectionId: 'old_conn_b' },
    },
    {
      name: 'Inherit',
      workspace: { kind: 'inherit', fromNode: 'Repo' },
    },
    {
      name: 'Tmp',
      workspace: { kind: 'fresh-tmpdir' },
    },
  ],
  edges: [],
  mcpServers: [
    {
      id: 'mcp1',
      name: 'gh-mcp',
      transport: { kind: 'http', url: 'https://example.test' },
      connectionId: 'old_conn_b',
    },
    {
      id: 'mcp2',
      name: 'no-creds',
      transport: { kind: 'http', url: 'https://example.test' },
    },
  ],
  ui: { positions: {} },
} as unknown as WorkflowDefinition;

describe('remapConnectionIds', () => {
  it('rewrites trigger, mcpServer, and workspace connectionIds via the map', () => {
    const map = { old_conn_a: 'new_conn_a', old_conn_b: 'new_conn_b' };
    const out = remapConnectionIds(baseDefinition, map);

    expect(out.triggers[0]!.connectionId).toBe('new_conn_a');
    expect(out.mcpServers[0]!.connectionId).toBe('new_conn_b');
    expect(out.mcpServers[1]!.connectionId).toBeUndefined();
    expect((out.nodes[0]!.workspace as { connectionId: string }).connectionId).toBe(
      'new_conn_a',
    );
    expect((out.nodes[1]!.workspace as { connectionId: string }).connectionId).toBe(
      'new_conn_b',
    );
  });

  it('leaves inherit/fresh-tmpdir workspaces untouched', () => {
    const out = remapConnectionIds(baseDefinition, { old_conn_a: 'new_conn_a' });
    expect(out.nodes[2]!.workspace).toEqual({ kind: 'inherit', fromNode: 'Repo' });
    expect(out.nodes[3]!.workspace).toEqual({ kind: 'fresh-tmpdir' });
  });

  it('leaves unknown ids intact', () => {
    const out = remapConnectionIds(baseDefinition, { other: 'x' });
    expect(out.triggers[0]!.connectionId).toBe('old_conn_a');
    expect((out.nodes[1]!.workspace as { connectionId: string }).connectionId).toBe(
      'old_conn_b',
    );
  });

  it('does not mutate the input', () => {
    const before = JSON.stringify(baseDefinition);
    remapConnectionIds(baseDefinition, { old_conn_a: 'new_conn_a' });
    expect(JSON.stringify(baseDefinition)).toBe(before);
  });
});
