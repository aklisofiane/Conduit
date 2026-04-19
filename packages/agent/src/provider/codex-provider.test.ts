import { afterEach, describe, expect, it } from 'vitest';
import { CodexProvider } from './codex-provider';
import { __setCodexSdkLoaderForTests } from './codex-provider';

interface StubCodexOptions {
  scriptedEvents: unknown[];
}

function installStub(opts: StubCodexOptions): void {
  class StubCodex {
    startThread() {
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
    expect(caps.models).toContain('gpt-5-codex');
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
});
