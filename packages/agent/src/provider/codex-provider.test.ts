import { afterEach, describe, expect, it } from 'vitest';
import { CodexProvider } from './codex-provider';
import { __setCodexSdkLoaderForTests } from './codex-provider';

interface StubCodexOptions {
  scriptedEvents: unknown[];
  onConstruct?: (options: Record<string, unknown> | undefined) => void;
  onStartThread?: (options: Record<string, unknown> | undefined) => void;
}

function installStub(opts: StubCodexOptions): void {
  class StubCodex {
    constructor(options?: Record<string, unknown>) {
      opts.onConstruct?.(options);
    }
    startThread(options?: Record<string, unknown>) {
      opts.onStartThread?.(options);
      async function* events() {
        for (const ev of opts.scriptedEvents) yield ev;
      }
      return {
        async runStreamed() {
          return { events: events() };
        },
      };
    }
  }
  __setCodexSdkLoaderForTests(async () => ({
    Codex: StubCodex as never,
  }));
}

afterEach(() => __setCodexSdkLoaderForTests(undefined));

describe('CodexProvider', () => {
  it('reports capabilities', () => {
    const p = new CodexProvider();
    const caps = p.getCapabilities();
    expect(caps.models).toContain('gpt-5.3-codex');
    expect(caps.supportsMcp).toBe(true);
  });

  it('translates a scripted stream end-to-end', async () => {
    installStub({
      scriptedEvents: [
        { type: 'thread.started', thread_id: 't_1' },
        { type: 'turn.started' },
        {
          type: 'item.updated',
          item: { id: 'msg_1', type: 'agent_message', text: 'Hello' },
        },
        {
          type: 'item.updated',
          item: { id: 'msg_1', type: 'agent_message', text: 'Hello, world' },
        },
        {
          type: 'item.started',
          item: {
            id: 'call_1',
            type: 'mcp_tool_call',
            server: 'github',
            tool: 'create_issue',
            arguments: { title: 'x' },
            status: 'in_progress',
          },
        },
        {
          type: 'item.completed',
          item: {
            id: 'call_1',
            type: 'mcp_tool_call',
            server: 'github',
            tool: 'create_issue',
            status: 'completed',
            result: { content: [] },
          },
        },
        {
          type: 'turn.completed',
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      ],
    });

    const events: unknown[] = [];
    const p = new CodexProvider();
    const session = p.startSession(
      {
        model: 'gpt-5-codex',
        systemPrompt: 'sys',
        mcpServers: [],
        workspacePath: '/tmp/x',
        constraints: {},
      } as never,
      new AbortController().signal,
    );
    for await (const e of session.run('user')) {
      events.push(e);
    }

    expect(events[0]).toEqual({ type: 'text', delta: 'Hello' });
    expect(events[1]).toEqual({ type: 'text', delta: ', world' });
    expect(events[2]).toMatchObject({
      type: 'tool_call',
      id: 'call_1',
      name: 'github.create_issue',
    });
    expect(events[3]).toMatchObject({ type: 'tool_result', id: 'call_1' });
    expect(events[4]).toMatchObject({ type: 'usage', inputTokens: 10, outputTokens: 5 });
    expect(events[5]).toEqual({ type: 'done' });
  });

  it('forwards additionalDirectories to startThread so the agent can write outside the workspace dir', async () => {
    let threadOptions: Record<string, unknown> | undefined;
    installStub({
      scriptedEvents: [{ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }],
      onStartThread: (options) => {
        threadOptions = options;
      },
    });

    const session = new CodexProvider().startSession(
      {
        model: 'gpt-5-codex',
        systemPrompt: '',
        mcpServers: [],
        workspacePath: '/runs/r1/Dev',
        additionalDirectories: ['/runs/r1', '/home/u/.conduit/base-clones'],
        webSearch: false,
        constraints: {},
      } as never,
      new AbortController().signal,
    );
    for await (const _ of session.run('')) void _;

    expect(threadOptions).toMatchObject({
      workingDirectory: '/runs/r1/Dev',
      // The runner container is the sandbox; codex's bubblewrap wrapper
      // can't run inside Docker's default seccomp profile, so we delegate
      // shell-command isolation to the container itself.
      sandboxMode: 'danger-full-access',
      additionalDirectories: ['/runs/r1', '/home/u/.conduit/base-clones'],
    });
  });

  it('passes resolved MCP servers to Codex with non-interactive approvals and tool allow-list', async () => {
    let constructOptions: Record<string, unknown> | undefined;
    installStub({
      scriptedEvents: [{ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }],
      onConstruct: (options) => {
        constructOptions = options;
      },
    });

    const session = new CodexProvider().startSession(
      {
        model: 'gpt-5-codex',
        systemPrompt: '',
        workspacePath: '/tmp',
        webSearch: false,
        constraints: {},
        mcpServers: [
          {
            id: 'github-mcp',
            name: 'GitHub',
            transport: {
              kind: 'stdio',
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-github'],
              env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'token' },
            },
            allowedTools: ['get_issue', 'update_issue'],
          },
        ],
      },
      new AbortController().signal,
    );

    for await (const _ of session.run('')) {
      void _;
    }

    expect(constructOptions).toMatchObject({
      config: {
        mcp_servers: {
          'github-mcp': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'token' },
            enabled_tools: ['get_issue', 'update_issue'],
            default_tools_approval_mode: 'approve',
          },
        },
      },
    });
  });

  it('passes remote bearer auth to Codex through bearer_token_env_var', async () => {
    let constructOptions: Record<string, unknown> | undefined;
    installStub({
      scriptedEvents: [{ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }],
      onConstruct: (options) => {
        constructOptions = options;
      },
    });

    const session = new CodexProvider().startSession(
      {
        model: 'gpt-5-codex',
        systemPrompt: '',
        workspacePath: '/tmp',
        webSearch: false,
        constraints: {},
        mcpServers: [
          {
            id: 'github-mcp',
            name: 'GitHub',
            transport: {
              kind: 'streamable-http',
              url: 'https://api.githubcopilot.com/mcp/',
              headers: {
                Authorization: 'Bearer ghp_secretvalue',
                'X-Custom': 'keep-me',
              },
            },
            allowedTools: ['update_project_item'],
          },
        ],
      },
      new AbortController().signal,
    );

    for await (const _ of session.run('')) {
      void _;
    }

    const mcp = (
      constructOptions?.config as { mcp_servers?: Record<string, Record<string, unknown>> }
    )?.mcp_servers?.['github-mcp'];
    const envVar = mcp?.bearer_token_env_var as string | undefined;

    expect(mcp).toMatchObject({
      url: 'https://api.githubcopilot.com/mcp/',
      headers: { 'X-Custom': 'keep-me' },
      enabled_tools: ['update_project_item'],
      default_tools_approval_mode: 'approve',
    });
    expect(envVar).toMatch(/^CONDUIT_CODEX_MCP_[A-Z0-9]+_0_GITHUB_MCP_BEARER_TOKEN$/);
    expect(process.env[envVar!]).toBe('ghp_secretvalue');

    session.dispose();
    expect(process.env[envVar!]).toBeUndefined();
  });

  it('throws on turn.failed', async () => {
    installStub({
      scriptedEvents: [
        { type: 'thread.started', thread_id: 't_1' },
        { type: 'turn.failed', error: { message: 'codex blew up' } },
      ],
    });

    const p = new CodexProvider();
    const session = p.startSession(
      {
        model: 'gpt-5-codex',
        systemPrompt: '',
        mcpServers: [],
        workspacePath: '/tmp',
        constraints: {},
      } as never,
      new AbortController().signal,
    );
    await expect(async () => {
      for await (const _ of session.run('')) {
        void _;
      }
    }).rejects.toThrow(/codex blew up/);
  });

  it('handles command_execution items as tool_call / tool_result', async () => {
    installStub({
      scriptedEvents: [
        { type: 'thread.started', thread_id: 't_1' },
        { type: 'turn.started' },
        {
          type: 'item.started',
          item: {
            id: 'cmd_1',
            type: 'command_execution',
            command: 'ls',
            status: 'in_progress',
            aggregated_output: '',
          },
        },
        {
          type: 'item.completed',
          item: {
            id: 'cmd_1',
            type: 'command_execution',
            command: 'ls',
            status: 'completed',
            aggregated_output: 'file1\nfile2\n',
            exit_code: 0,
          },
        },
        { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
      ],
    });

    const p = new CodexProvider();
    const events: unknown[] = [];
    const session = p.startSession(
      {
        model: 'gpt-5-codex',
        systemPrompt: '',
        mcpServers: [],
        workspacePath: '/tmp',
        constraints: {},
      } as never,
      new AbortController().signal,
    );
    for await (const e of session.run('')) {
      events.push(e);
    }

    expect(events[0]).toMatchObject({
      type: 'tool_call',
      id: 'cmd_1',
      name: 'bash',
      input: { command: 'ls' },
    });
    expect(events[1]).toMatchObject({
      type: 'tool_result',
      id: 'cmd_1',
      output: 'file1\nfile2\n',
    });
  });

  it('translates a single-file file_change into a Write/Edit/Delete pair', async () => {
    installStub({
      scriptedEvents: [
        { type: 'thread.started', thread_id: 't_1' },
        { type: 'turn.started' },
        {
          type: 'item.completed',
          item: {
            id: 'fc_1',
            type: 'file_change',
            status: 'completed',
            changes: [{ path: '.conduit/Review.md', kind: 'add' }],
          },
        },
        { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
      ],
    });

    const events: unknown[] = [];
    const session = new CodexProvider().startSession(
      {
        model: 'gpt-5-codex',
        systemPrompt: '',
        mcpServers: [],
        workspacePath: '/tmp',
        constraints: {},
      } as never,
      new AbortController().signal,
    );
    for await (const e of session.run('')) events.push(e);

    expect(events[0]).toEqual({
      type: 'tool_call',
      id: 'fc_1:0',
      name: 'Write',
      input: { file_path: '.conduit/Review.md' },
    });
    expect(events[1]).toEqual({
      type: 'tool_result',
      id: 'fc_1:0',
      output: 'add',
    });
  });

  it('translates a multi-file file_change with per-change ids and kind-based names', async () => {
    installStub({
      scriptedEvents: [
        { type: 'thread.started', thread_id: 't_1' },
        { type: 'turn.started' },
        {
          type: 'item.completed',
          item: {
            id: 'fc_2',
            type: 'file_change',
            status: 'completed',
            changes: [
              { path: 'src/new.ts', kind: 'add' },
              { path: 'src/existing.ts', kind: 'update' },
              { path: 'src/old.ts', kind: 'delete' },
            ],
          },
        },
        { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
      ],
    });

    const events: unknown[] = [];
    const session = new CodexProvider().startSession(
      {
        model: 'gpt-5-codex',
        systemPrompt: '',
        mcpServers: [],
        workspacePath: '/tmp',
        constraints: {},
      } as never,
      new AbortController().signal,
    );
    for await (const e of session.run('')) events.push(e);

    expect(events[0]).toMatchObject({ type: 'tool_call', id: 'fc_2:0', name: 'Write' });
    expect(events[2]).toMatchObject({ type: 'tool_call', id: 'fc_2:1', name: 'Edit' });
    expect(events[4]).toMatchObject({
      type: 'tool_call',
      id: 'fc_2:2',
      name: 'Delete',
      input: { file_path: 'src/old.ts' },
    });
  });

  it('marks a failed file_change with an error on each change', async () => {
    installStub({
      scriptedEvents: [
        { type: 'thread.started', thread_id: 't_1' },
        { type: 'turn.started' },
        {
          type: 'item.completed',
          item: {
            id: 'fc_3',
            type: 'file_change',
            status: 'failed',
            changes: [{ path: 'readonly/file.ts', kind: 'update' }],
          },
        },
        { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
      ],
    });

    const events: unknown[] = [];
    const session = new CodexProvider().startSession(
      {
        model: 'gpt-5-codex',
        systemPrompt: '',
        mcpServers: [],
        workspacePath: '/tmp',
        constraints: {},
      } as never,
      new AbortController().signal,
    );
    for await (const e of session.run('')) events.push(e);

    expect(events[1]).toMatchObject({
      type: 'tool_result',
      id: 'fc_3:0',
      error: 'patch failed',
    });
  });

  it('translates todo_list updates as TodoWrite snapshots and skips item.started', async () => {
    installStub({
      scriptedEvents: [
        { type: 'thread.started', thread_id: 't_1' },
        { type: 'turn.started' },
        {
          type: 'item.started',
          item: { id: 'tl_1', type: 'todo_list', items: [] },
        },
        {
          type: 'item.updated',
          item: {
            id: 'tl_1',
            type: 'todo_list',
            items: [
              { text: 'one', completed: false },
              { text: 'two', completed: false },
            ],
          },
        },
        {
          type: 'item.completed',
          item: {
            id: 'tl_1',
            type: 'todo_list',
            items: [
              { text: 'one', completed: true },
              { text: 'two', completed: true },
            ],
          },
        },
        { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
      ],
    });

    const events: unknown[] = [];
    const session = new CodexProvider().startSession(
      {
        model: 'gpt-5-codex',
        systemPrompt: '',
        mcpServers: [],
        workspacePath: '/tmp',
        constraints: {},
      } as never,
      new AbortController().signal,
    );
    for await (const e of session.run('')) events.push(e);

    // item.started was skipped, so two snapshots emitted (updated + completed),
    // each as a tool_call/tool_result pair = 4 events before usage/done.
    expect(events[0]).toMatchObject({
      type: 'tool_call',
      id: 'tl_1:1',
      name: 'TodoWrite',
      input: {
        todos: [
          { content: 'one', status: 'pending' },
          { content: 'two', status: 'pending' },
        ],
      },
    });
    expect(events[2]).toMatchObject({
      type: 'tool_call',
      id: 'tl_1:2',
      name: 'TodoWrite',
      input: {
        todos: [
          { content: 'one', status: 'completed' },
          { content: 'two', status: 'completed' },
        ],
      },
    });
  });

  it('surfaces non-fatal error items as a codex.error tool pair', async () => {
    installStub({
      scriptedEvents: [
        { type: 'thread.started', thread_id: 't_1' },
        { type: 'turn.started' },
        {
          type: 'item.completed',
          item: { id: 'err_1', type: 'error', message: 'mcp tool returned non-2xx' },
        },
        { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
      ],
    });

    const events: unknown[] = [];
    const session = new CodexProvider().startSession(
      {
        model: 'gpt-5-codex',
        systemPrompt: '',
        mcpServers: [],
        workspacePath: '/tmp',
        constraints: {},
      } as never,
      new AbortController().signal,
    );
    for await (const e of session.run('')) events.push(e);

    expect(events[0]).toEqual({
      type: 'tool_call',
      id: 'err_1',
      name: 'codex.error',
      input: { message: 'mcp tool returned non-2xx' },
    });
    expect(events[1]).toEqual({
      type: 'tool_result',
      id: 'err_1',
      output: 'mcp tool returned non-2xx',
      error: 'mcp tool returned non-2xx',
    });
  });

  it('translates web_search items as tool_call / tool_result', async () => {
    installStub({
      scriptedEvents: [
        { type: 'thread.started', thread_id: 't_1' },
        { type: 'turn.started' },
        {
          type: 'item.started',
          item: { id: 'ws_1', type: 'web_search', query: 'kimi agent sdk npm' },
        },
        {
          type: 'item.completed',
          item: { id: 'ws_1', type: 'web_search', query: 'kimi agent sdk npm' },
        },
        { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
      ],
    });

    const p = new CodexProvider();
    const events: unknown[] = [];
    const session = p.startSession(
      {
        model: 'gpt-5-codex',
        systemPrompt: '',
        mcpServers: [],
        workspacePath: '/tmp',
        webSearch: true,
        constraints: {},
      },
      new AbortController().signal,
    );
    for await (const e of session.run('')) {
      events.push(e);
    }

    expect(events[0]).toMatchObject({
      type: 'tool_call',
      id: 'ws_1',
      name: 'web_search',
      input: { query: 'kimi agent sdk npm' },
    });
    expect(events[1]).toMatchObject({
      type: 'tool_result',
      id: 'ws_1',
      output: 'kimi agent sdk npm',
    });
  });
});
