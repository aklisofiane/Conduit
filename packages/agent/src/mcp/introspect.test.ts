import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { introspectMcpServer, McpIntrospectionError } from './introspect';

const STUB = path.resolve(__dirname, '../../../../test/fixtures/mcp-stub/server.mjs');

describe('introspectMcpServer', () => {
  it('lists tools from an stdio MCP server', async () => {
    const tools = await introspectMcpServer({
      kind: 'stdio',
      command: process.execPath,
      args: [STUB],
    });

    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get('echo')?.description).toMatch(/verbatim/i);
    expect(byName.get('add')?.inputSchema).toEqual({
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    });
    expect(tools.map((t) => t.name).sort()).toEqual(['add', 'echo', 'fail']);
  });

  it('throws McpIntrospectionError when the stdio command cannot spawn', async () => {
    await expect(
      introspectMcpServer({
        kind: 'stdio',
        command: '/definitely/not/a/real/binary',
      }),
    ).rejects.toBeInstanceOf(McpIntrospectionError);
  });

  it('times out if the server never responds', async () => {
    // `sleep` holds the child process open without writing to stdout, so the
    // client's initialize request never gets a response.
    await expect(
      introspectMcpServer(
        { kind: 'stdio', command: 'sleep', args: ['30'] },
        { timeoutMs: 150 },
      ),
    ).rejects.toThrow(/timed out/i);
  });
});
