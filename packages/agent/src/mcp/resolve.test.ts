import { describe, expect, it } from 'vitest';
import type { WorkflowMcpServer } from '@conduit/shared';
import { findMcpPreset } from '@conduit/shared';
import { resolveMcpServers } from './resolve';

describe('resolveMcpServers + presets', () => {
  it('substitutes credentials into the shipped GitHub preset', async () => {
    const preset = findMcpPreset('github');
    if (!preset) throw new Error('github preset missing');

    const workflowServer: WorkflowMcpServer = {
      id: 'github',
      name: preset.name,
      transport: preset.transport,
      connectionId: 'conn_github',
    };

    const [resolved] = await resolveMcpServers(
      { mcpServers: [{ serverId: 'github', allowedTools: ['create_issue'] }] },
      [workflowServer],
      async (id) => (id === 'conn_github' ? 'ghp_secretvalue' : undefined),
    );

    expect(resolved?.id).toBe('github');
    expect(resolved?.allowedTools).toEqual(['create_issue']);
    if (resolved?.transport.kind !== 'streamable-http') {
      throw new Error('expected streamable-http');
    }
    expect(resolved.transport.headers?.Authorization).toBe('Bearer ghp_secretvalue');
    // URL remains untouched.
    expect(resolved.transport.url).toBe('https://api.githubcopilot.com/mcp/');
  });

  it('fails clearly when the linked connection has no secret', async () => {
    const preset = findMcpPreset('github')!;
    const workflowServer: WorkflowMcpServer = {
      id: 'github',
      name: preset.name,
      transport: preset.transport,
      connectionId: 'conn_missing',
    };
    await expect(
      resolveMcpServers(
        { mcpServers: [{ serverId: 'github' }] },
        [workflowServer],
        async () => undefined,
      ),
    ).rejects.toThrow(/no credential was resolved/);
  });
});
