import { describe, expect, it } from 'vitest';
import { mcpTransportSchema } from './transport';
import { workflowMcpServerSchema } from './server';
import { findMcpPreset, MCP_PRESETS } from './presets';
import { CREDENTIAL_PLACEHOLDER_VALUE } from './placeholder';

describe('MCP presets', () => {
  it.each(MCP_PRESETS.map((p) => [p.id, p] as const))(
    '%s preset validates as an MCP transport',
    (_id, preset) => {
      expect(mcpTransportSchema.safeParse(preset.transport).success).toBe(true);
    },
  );

  it.each(MCP_PRESETS.map((p) => [p.id, p] as const))(
    '%s preset slots into WorkflowMcpServer without modification',
    (_id, preset) => {
      const server = {
        id: preset.id,
        name: preset.name,
        transport: preset.transport,
        connectionId: 'conn_stub',
      };
      expect(workflowMcpServerSchema.safeParse(server).success).toBe(true);
    },
  );

  it('findMcpPreset is case-sensitive and returns undefined for misses', () => {
    expect(findMcpPreset('github')?.name).toBe('GitHub');
    expect(findMcpPreset('GITHUB')).toBeUndefined();
    expect(findMcpPreset('nope')).toBeUndefined();
  });

  it('Phase 2 ships the GitHub preset with a {{credential}} placeholder', () => {
    const github = findMcpPreset('github');
    expect(github).toBeDefined();
    expect(github?.transport).toMatchObject({
      kind: 'stdio',
      command: 'npx',
    });
    if (github?.transport.kind === 'stdio') {
      expect(github.transport.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBe(
        CREDENTIAL_PLACEHOLDER_VALUE,
      );
    }
    expect(github?.platform).toBe('GITHUB');
  });

  it('preset ids are unique', () => {
    const ids = MCP_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
