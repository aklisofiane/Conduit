import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentEvent, AgentRequest } from '@conduit/shared';
import {
  ConstraintExceededError,
  StubProvider,
  clearStubScripts,
  queueStubScript,
  queueStubSession,
} from '../index';

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

function baseRequest(overrides: Partial<AgentRequest> = {}): AgentRequest {
  return {
    model: 'stub-model',
    systemPrompt: 'do the thing',
    mcpServers: [],
    workspacePath: overrides.workspacePath ?? '/tmp/unused',
    constraints: {},
    ...overrides,
  };
}

describe('StubProvider', () => {
  let workspace: string;

  beforeEach(async () => {
    clearStubScripts();
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'stub-prov-'));
    delete process.env.CONDUIT_STUB_SCRIPT;
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('replays queued events in order and ends on done', async () => {
    queueStubScript({
      steps: [
        { kind: 'text', delta: 'hello ' },
        { kind: 'text', delta: 'world' },
        { kind: 'usage', inputTokens: 5, outputTokens: 3 },
        { kind: 'done' },
      ],
    });
    const provider = new StubProvider();
    const session = provider.startSession(
      baseRequest({ workspacePath: workspace }),
      new AbortController().signal,
    );
    const events = await collect(session.run('hello'));
    expect(events.map((e) => e.type)).toEqual(['text', 'text', 'usage', 'done']);
  });

  it('write-file steps land inside the workspace without emitting events', async () => {
    queueStubScript({
      steps: [
        { kind: 'write-file', path: 'out/hello.txt', content: 'hi' },
        { kind: 'done' },
      ],
    });
    const session = new StubProvider().startSession(
      baseRequest({ workspacePath: workspace }),
      new AbortController().signal,
    );
    const events = await collect(session.run(''));
    expect(events.map((e) => e.type)).toEqual(['done']);
    expect(await fs.readFile(path.join(workspace, 'out', 'hello.txt'), 'utf8')).toBe('hi');
  });

  it('enforces maxToolCalls via shared constraint check', async () => {
    queueStubScript({
      steps: [
        { kind: 'tool_call', id: 't1', name: 'Bash', input: { cmd: 'ls' } },
        { kind: 'tool_call', id: 't2', name: 'Bash', input: { cmd: 'ls' } },
        { kind: 'done' },
      ],
    });
    const req = baseRequest({ workspacePath: workspace, constraints: { maxToolCalls: 1 } });
    const session = new StubProvider().startSession(req, new AbortController().signal);
    await expect(collect(session.run(''))).rejects.toBeInstanceOf(ConstraintExceededError);
  });

  it('stops streaming when the caller aborts', async () => {
    queueStubScript({
      steps: [
        { kind: 'text', delta: 'a', delayMs: 50 },
        { kind: 'text', delta: 'b', delayMs: 1_000 },
        { kind: 'done' },
      ],
    });
    const ctrl = new AbortController();
    const session = new StubProvider().startSession(
      baseRequest({ workspacePath: workspace }),
      ctrl.signal,
    );
    const iter = session.run('')[Symbol.asyncIterator]();

    const first = await iter.next();
    expect(first.done).toBe(false);
    ctrl.abort();
    const next = await iter.next();
    expect(next.done).toBe(true);
  });

  it('falls back to CONDUIT_STUB_SCRIPT when nothing is queued', async () => {
    const scriptPath = path.join(workspace, 'script.json');
    await fs.writeFile(
      scriptPath,
      JSON.stringify({ steps: [{ kind: 'text', delta: 'from-file' }, { kind: 'done' }] }),
    );
    process.env.CONDUIT_STUB_SCRIPT = scriptPath;
    const session = new StubProvider().startSession(
      baseRequest({ workspacePath: workspace }),
      new AbortController().signal,
    );
    const events = await collect(session.run(''));
    const first = events[0];
    expect(first?.type).toBe('text');
    if (first?.type === 'text') expect(first.delta).toBe('from-file');
  });

  it('drives multi-turn sessions from queueStubSession in order', async () => {
    queueStubSession({
      turns: [
        { steps: [{ kind: 'text', delta: 'turn-1' }, { kind: 'done' }] },
        {
          steps: [
            { kind: 'write-file', path: '.conduit/Agent.md', content: '# summary' },
            { kind: 'done' },
          ],
        },
      ],
    });
    const session = new StubProvider().startSession(
      baseRequest({ workspacePath: workspace }),
      new AbortController().signal,
    );
    const first = await collect(session.run(''));
    expect((first[0] as { type: string; delta: string }).delta).toBe('turn-1');
    const second = await collect(session.run('summarize'));
    expect(second.map((e) => e.type)).toEqual(['done']);
    expect(await fs.readFile(path.join(workspace, '.conduit/Agent.md'), 'utf8')).toBe('# summary');
  });

  it('synthesizes `done` on extra run() calls after the scripted turns are exhausted', async () => {
    queueStubScript({ steps: [{ kind: 'text', delta: 'only' }, { kind: 'done' }] });
    const session = new StubProvider().startSession(
      baseRequest({ workspacePath: workspace }),
      new AbortController().signal,
    );
    await collect(session.run(''));
    const extra = await collect(session.run('summarize'));
    expect(extra).toEqual([{ type: 'done' }]);
  });
});
