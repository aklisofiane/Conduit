import { afterEach, describe, expect, it } from 'vitest';
import {
  ClaudeProvider,
  __setClaudeSdkLoaderForTests,
  type SdkCanUseTool,
} from './claude-provider';

interface CapturedOptions {
  canUseTool: SdkCanUseTool;
  mcpServers: Record<string, unknown>;
  disallowedTools?: string[];
}

function installStub(events: unknown[] = [{ type: 'result' }]): {
  capturedOptions: CapturedOptions | undefined;
} {
  const out: { capturedOptions: CapturedOptions | undefined } = { capturedOptions: undefined };
  const sdk = {
    query(args: unknown) {
      const a = args as { options: CapturedOptions };
      out.capturedOptions = a.options;
      async function* stream() {
        for (const event of events) yield event;
      }
      return stream();
    },
  };
  __setClaudeSdkLoaderForTests(async () => sdk);
  return out;
}

afterEach(() => __setClaudeSdkLoaderForTests(undefined));

describe('ClaudeProvider', () => {
  it('reports capabilities', () => {
    const p = new ClaudeProvider();
    const caps = p.getCapabilities();
    expect(caps.models).toContain('claude-sonnet-4-6');
    expect(caps.supportsMcp).toBe(true);
  });

  it('canUseTool gates MCP tools by per-server allowedTools', async () => {
    const captured = installStub();
    const p = new ClaudeProvider();
    const session = p.startSession(
      {
        model: 'claude-sonnet-4-6',
        systemPrompt: 'sys',
        mcpServers: [
          {
            id: 'server1',
            name: 'server1',
            transport: { kind: 'stdio', command: 'noop' },
            allowedTools: ['get_issue'],
          },
          {
            id: 'server2',
            name: 'server2',
            transport: { kind: 'stdio', command: 'noop' },
          },
        ],
        workspacePath: '/tmp/x',
        constraints: {},
      } as never,
      new AbortController().signal,
    );

    // Drive the generator so query() runs and we capture options.
    for await (const _ of session.run('hi')) void _;

    const opts = captured.capturedOptions;
    if (!opts) throw new Error('query() was not called');
    expect(typeof opts.canUseTool).toBe('function');

    // Built-in tools are always allowed — agent config has no built-in whitelist.
    expect(await opts.canUseTool('Bash', { cmd: 'ls' })).toEqual({
      behavior: 'allow',
      updatedInput: { cmd: 'ls' },
    });

    // Whitelisted MCP tool from server1 is allowed.
    expect(await opts.canUseTool('mcp__server1__get_issue', {})).toMatchObject({
      behavior: 'allow',
    });

    // Non-whitelisted MCP tool from server1 is denied.
    expect(await opts.canUseTool('mcp__server1__create_issue', {})).toMatchObject({
      behavior: 'deny',
    });

    // server2 has no allowedTools filter — allow any tool from it.
    expect(await opts.canUseTool('mcp__server2__anything', {})).toMatchObject({
      behavior: 'allow',
    });

    // Unknown server id is denied.
    expect(await opts.canUseTool('mcp__unknown__foo', {})).toMatchObject({
      behavior: 'deny',
    });
  });

  it('disables WebSearch and WebFetch when webSearch is false', async () => {
    const captured = installStub();
    const p = new ClaudeProvider();
    const session = p.startSession(
      {
        model: 'claude-sonnet-4-6',
        systemPrompt: 'sys',
        mcpServers: [],
        workspacePath: '/tmp/x',
        webSearch: false,
        constraints: {},
      },
      new AbortController().signal,
    );
    for await (const _ of session.run('hi')) void _;

    expect(captured.capturedOptions?.disallowedTools).toEqual(['WebSearch', 'WebFetch']);
  });

  it('leaves WebSearch and WebFetch available when webSearch is true', async () => {
    const captured = installStub();
    const p = new ClaudeProvider();
    const session = p.startSession(
      {
        model: 'claude-sonnet-4-6',
        systemPrompt: 'sys',
        mcpServers: [],
        workspacePath: '/tmp/x',
        webSearch: true,
        constraints: {},
      },
      new AbortController().signal,
    );
    for await (const _ of session.run('hi')) void _;

    expect(captured.capturedOptions?.disallowedTools).toBeUndefined();
  });

  it('throws when the Claude SDK returns an error result', async () => {
    installStub([
      {
        type: 'result',
        subtype: 'success',
        is_error: true,
        api_error_status: 401,
        result: 'Failed to authenticate. API Error: 401 Invalid bearer token',
      },
    ]);
    const p = new ClaudeProvider();
    const session = p.startSession(
      {
        model: 'claude-sonnet-4-6',
        systemPrompt: 'sys',
        mcpServers: [],
        workspacePath: '/tmp/x',
        webSearch: false,
        constraints: {},
      },
      new AbortController().signal,
    );

    await expect(async () => {
      for await (const _ of session.run('hi')) void _;
    }).rejects.toThrow(
      'Claude Code failed: API 401: Failed to authenticate. API Error: 401 Invalid bearer token',
    );
  });
});
