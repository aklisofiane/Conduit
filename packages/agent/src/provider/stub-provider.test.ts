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
    userMessage: '{}',
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
    const events = await collect(
      provider.execute(baseRequest({ workspacePath: workspace }), new AbortController().signal),
    );
    expect(events.map((e) => e.type)).toEqual(['text', 'text', 'usage', 'done']);
  });

  it('write-file steps land inside the workspace without emitting events', async () => {
    queueStubScript({
      steps: [
        { kind: 'write-file', path: 'out/hello.txt', content: 'hi' },
        { kind: 'done' },
      ],
    });
    const events = await collect(
      new StubProvider().execute(
        baseRequest({ workspacePath: workspace }),
        new AbortController().signal,
      ),
    );
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
    await expect(collect(new StubProvider().execute(req, new AbortController().signal))).rejects.toBeInstanceOf(
      ConstraintExceededError,
    );
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
    const iter = new StubProvider().execute(baseRequest({ workspacePath: workspace }), ctrl.signal)[
      Symbol.asyncIterator
    ]();

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
    const events = await collect(
      new StubProvider().execute(baseRequest({ workspacePath: workspace }), new AbortController().signal),
    );
    const first = events[0];
    expect(first?.type).toBe('text');
    if (first?.type === 'text') expect(first.delta).toBe('from-file');
  });
});
