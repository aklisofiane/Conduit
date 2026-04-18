import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from '@conduit/shared';
import { loadWorkflowFixture } from '../helpers/temporal';
import { startHarness, type Harness } from './harness';

/**
 * Phase 1 exit criterion as an E2E test (see docs/PLANS.md "Phase 1"):
 *
 *   User creates a workflow with a Claude agent + workspace, clicks "Run",
 *   agent uses SDK built-in tools (file read, shell), watches streaming
 *   output on the run detail page.
 *
 * Stub-backed version: the real LLM is replaced by StubProvider, but the
 * workflow creation, Temporal dispatch, agent activity, workspace setup,
 * Redis pub/sub, and WS gateway all run for real.
 */

interface WorkflowRunResponse {
  id: string;
  status: string;
  temporalWorkflowId?: string | null;
  temporalRunId?: string | null;
}

interface WorkflowResponse {
  id: string;
  name: string;
  description?: string | null;
  definition: WorkflowDefinition;
}

describe('Phase 1 — manual run streams agent output', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness();
  });

  afterAll(async () => {
    await harness?.stop();
  });

  it('creates a workflow, runs it manually, and streams scripted events to the run WS', async () => {
    const fixture = await loadWorkflowFixture('phase1-manual-run');
    const created = await harness.http.post<WorkflowResponse>('/workflows', {
      name: fixture.name,
      description: fixture.description,
      definition: fixture.definition,
    });

    await harness.setStubScript({
      steps: [
        { kind: 'text', delta: 'Reading the issue...' },
        { kind: 'tool_call', id: 'call_1', name: 'Read', input: { path: 'README.md' } },
        { kind: 'tool_result', id: 'call_1', output: 'ok' },
        { kind: 'write-file', path: 'out/summary.txt', content: 'phase 1 ran' },
        { kind: 'usage', inputTokens: 10, outputTokens: 5 },
        { kind: 'done' },
      ],
    });

    const run = await harness.http.post<WorkflowRunResponse>(`/workflows/${created.id}/run`, {});
    const collector = harness.collectRun(run.id);
    try {
      await collector.waitForDone('Main', 30_000);
    } finally {
      collector.close();
    }

    // Agent `done` fires inside runAgentNode; `cleanupRunActivity` flips the
    // WorkflowRun to COMPLETED on a subsequent Temporal activity. Poll for it.
    const finalRun = await pollForStatus(
      () => harness.http.get<WorkflowRunResponse>(`/runs/${run.id}`),
      (r) => r.status === 'COMPLETED' || r.status === 'FAILED',
      15_000,
    );
    expect(finalRun.status).toBe('COMPLETED');

    const frames = collector.frames();
    const eventTypes = frames.map((f) => f.event.type);
    expect(eventTypes).toContain('text');
    expect(eventTypes).toContain('tool_call');
    expect(eventTypes).toContain('done');

    const textFrame = frames.find((f) => f.event.type === 'text');
    expect(textFrame?.nodeName).toBe('Main');
    if (textFrame?.event.type === 'text') {
      expect(textFrame.event.delta).toBe('Reading the issue...');
    }
  });
});

async function pollForStatus<T>(
  fetch: () => Promise<T>,
  ready: (value: T) => boolean,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await fetch();
    if (ready(last)) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms. Last value: ${JSON.stringify(last)}`,
  );
}
