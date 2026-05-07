import { describe, expect, it } from 'vitest';
import { runnerEventSchema, runnerRequestSchema } from '@conduit/shared/runner';

/**
 * The runner has no orchestrator side and no host filesystem to mock — the
 * unit-testable surface is the wire protocol itself: the schemas are the
 * contract between phases (Docker → k8s Jobs → ...).
 */
describe('runner protocol', () => {
  it('round-trips a minimal request', () => {
    const req = runnerRequestSchema.parse({
      protocolVersion: 1,
      run: {
        runId: 'r1',
        workflowId: 'wf1',
        workflowName: 'demo',
        nodeName: 'Worker',
      },
      provider: { id: 'claude' },
      agent: {
        model: 'claude-sonnet-4-6',
        systemPrompt: 'You are a worker.',
        mcpServers: [],
        workspacePath: '/tmp/ws',
        webSearch: false,
        constraints: {},
      },
      prompts: { main: '{}', summary: 'Write a summary.' },
    });
    expect(req.run.nodeName).toBe('Worker');
    expect(req.agent.constraints).toEqual({});
  });

  it('rejects an unknown event kind', () => {
    expect(() => runnerEventSchema.parse({ kind: 'nope' })).toThrow();
  });

  it('discriminates terminal exit events on `ok`', () => {
    const ok = runnerEventSchema.parse({
      kind: 'exit',
      ok: true,
      changedFiles: ['src/a.ts'],
      conduitSummary: '# Worker\n',
    });
    if (ok.kind !== 'exit' || !ok.ok) throw new Error('discriminator failed');
    expect(ok.changedFiles).toEqual(['src/a.ts']);

    const err = runnerEventSchema.parse({
      kind: 'exit',
      ok: false,
      error: { message: 'boom' },
    });
    if (err.kind !== 'exit' || err.ok !== false) throw new Error('discriminator failed');
    expect(err.error.message).toBe('boom');
  });
});
