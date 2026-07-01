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
  effort?: string;
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
    expect(caps.models).toContain('claude-sonnet-5');
    expect(caps.supportsMcp).toBe(true);
  });

  it('canUseTool gates MCP tools by per-server allowedTools', async () => {
    const captured = installStub();
    const p = new ClaudeProvider();
    const session = p.startSession(
      {
        model: 'claude-sonnet-5',
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
        model: 'claude-sonnet-5',
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
        model: 'claude-sonnet-5',
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

  it('forwards effort to query() when set', async () => {
    const captured = installStub();
    const session = new ClaudeProvider().startSession(
      {
        model: 'claude-sonnet-5',
        systemPrompt: 'sys',
        mcpServers: [],
        workspacePath: '/tmp/x',
        webSearch: false,
        effort: 'xhigh',
        constraints: {},
      },
      new AbortController().signal,
    );
    for await (const _ of session.run('hi')) void _;

    expect(captured.capturedOptions?.effort).toBe('xhigh');
  });

  it('omits effort from query() when unset so the SDK default applies', async () => {
    const captured = installStub();
    const session = new ClaudeProvider().startSession(
      {
        model: 'claude-sonnet-5',
        systemPrompt: 'sys',
        mcpServers: [],
        workspacePath: '/tmp/x',
        webSearch: false,
        constraints: {},
      },
      new AbortController().signal,
    );
    for await (const _ of session.run('hi')) void _;

    expect(captured.capturedOptions && 'effort' in captured.capturedOptions).toBe(false);
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
        model: 'claude-sonnet-5',
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

  it('emits one cumulative usage event from the result message, not per assistant message', async () => {
    installStub([
      // An assistant message carrying usage must NOT produce a usage event —
      // summing per-message input over-counts the re-sent context every turn.
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }],
          usage: { input_tokens: 5000, output_tokens: 40 },
        },
      },
      // The result carries the SDK's cumulative-per-turn rollup + cost.
      {
        type: 'result',
        subtype: 'success',
        total_cost_usd: 0.1234,
        usage: {
          input_tokens: 1200,
          output_tokens: 800,
          cache_creation_input_tokens: 3000,
          cache_read_input_tokens: 240000,
        },
      },
    ]);
    const session = new ClaudeProvider().startSession(
      {
        model: 'claude-sonnet-5',
        systemPrompt: 'sys',
        mcpServers: [],
        workspacePath: '/tmp/x',
        webSearch: false,
        constraints: {},
      },
      new AbortController().signal,
    );

    const events = [];
    for await (const e of session.run('hi')) events.push(e);

    const usageEvents = events.filter((e) => e.type === 'usage');
    expect(usageEvents).toEqual([
      {
        type: 'usage',
        inputTokens: 1200,
        outputTokens: 800,
        cachedInputTokens: 240000,
        cacheCreationInputTokens: 3000,
        costUsd: 0.1234,
      },
    ]);
    // The tool_use block still surfaces as a tool_call.
    expect(events.some((e) => e.type === 'tool_call' && e.id === 't1')).toBe(true);
  });
});
