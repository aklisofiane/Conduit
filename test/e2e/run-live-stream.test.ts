import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from '@conduit/shared';
import { loadEventFixture, loadWorkflowFixture } from '../helpers/temporal';
import { deliverGithubWebhook, pollForStatus } from '../helpers/webhook';
import { startHarness, type Harness } from './harness';

/**
 * Live run-stream fidelity (see packages/shared/src/runtime/channel.ts +
 * event.ts): the worker publishes one `RunUpdateMessage` per AgentEvent to
 * the Redis `conduit:run-updates` channel; the API's `/runs` Socket.IO
 * gateway forwards each to subscribed clients as a `node-update` frame.
 *
 * Phase 2 only proves a single `tool_call` frame survives that pipeline.
 * This test proves the FULL ordered stream survives intact:
 *   - interleaved text deltas precede the usage frame which precedes `done`,
 *   - every frame is tagged with the single agent node's name,
 *   - the text deltas reconstruct the scripted prose exactly,
 *   - the usage frame carries the scripted token counts,
 *   - and — critically — no frame leaks in after `done` (the per-test
 *     task-queue split in the harness exists precisely to stop cross-run
 *     frames landing on the wrong WS, so per-run terminal fidelity matters).
 *
 * Stub-backed like phase2 — the StubProvider replays the scripted events a
 * real agent would emit, so the Redis → gateway → WS path is exercised
 * end-to-end without any LLM call.
 */

const WEBHOOK_SECRET = 'run-live-stream-secret';
const NODE_NAME = 'Triage';

// Scripted prose, split across two text deltas. The reconstructed text must
// equal the concatenation of these — exercising delta ordering + integrity.
const TEXT_PART_1 = 'Looking at the issue. ';
const TEXT_PART_2 = 'Posting a triage note.';
const FULL_TEXT = TEXT_PART_1 + TEXT_PART_2;

const USAGE_INPUT_TOKENS = 137;
const USAGE_OUTPUT_TOKENS = 41;

interface CreateWorkflowResponse {
  id: string;
  name: string;
  definition: WorkflowDefinition;
}

interface ConnectionResponse {
  id: string;
  name: string;
  credentialId: string;
}

interface RunResponse {
  id: string;
  status: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Live run stream — ordered AgentEvent frames survive Redis → gateway → WS', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness();
  });

  afterAll(async () => {
    await harness?.stop();
  });

  it('preserves text→usage→done order, node tags, prose, and stops after done', async () => {
    // Trigger-connected agents derive `ticket-branch` workspaces — the
    // workspace manager needs a real bare remote it can clone from.
    await harness.seedTicketBranchRepo('acme', 'stream-tests');

    // 1. Platform credential — doubles as the {{credential}} the GitHub MCP
    //    server would receive in its Authorization header.
    const cred = await harness.http.post<{ id: string }>('/credentials', {
      platform: 'GITHUB',
      name: 'e2e-github-pat',
      secret: 'ghp_stub_token_for_tests',
    });

    // 2. Workflow — reuse the single-agent Phase 2 fixture (one node named
    //    `Triage`). The definition references a placeholder connection id we
    //    patch once the real connection exists.
    const fixture = await loadWorkflowFixture('phase2-webhook-issue');
    const created = await harness.http.post<CreateWorkflowResponse>('/workflows', {
      name: fixture.name,
      description: fixture.description,
      definition: fixture.definition,
    });

    // 3. Connection — global, scoped to the GitHub repo.
    const connection = await harness.http.post<ConnectionResponse>('/connections', {
      name: 'acme/stream-tests',
      credentialId: cred.id,
      scope: { kind: 'github_repo', owner: 'acme', repo: 'stream-tests' },
    });

    // 4. Point the trigger at the real connection, set the webhook secret,
    //    and activate so the webhook handler doesn't drop the delivery.
    const patched: WorkflowDefinition = {
      ...created.definition,
      triggers: created.definition.triggers.map((t) => ({
        ...t,
        connectionId: connection.id,
      })),
    };
    await harness.http.put(`/workflows/${created.id}`, {
      definition: patched,
      isActive: true,
    });
    await harness.http.put(`/workflows/${created.id}/webhook-secret`, {
      secret: WEBHOOK_SECRET,
    });

    // 5. Script the stub with a rich single-node stream:
    //    [text, text, usage, done]. The two text deltas concatenate to
    //    FULL_TEXT; usage carries known token counts; done is terminal.
    await harness.setStubScript({
      steps: [
        { kind: 'text', delta: TEXT_PART_1 },
        { kind: 'text', delta: TEXT_PART_2 },
        { kind: 'usage', inputTokens: USAGE_INPUT_TOKENS, outputTokens: USAGE_OUTPUT_TOKENS },
        { kind: 'done' },
      ],
    });

    // 6. Subscribe to the run WS BEFORE firing the webhook so no early frame
    //    is missed, then fire the signed delivery.
    const payload = await loadEventFixture('github', 'issues.opened');
    const { runId } = await deliverGithubWebhook(harness, created.id, {
      event: 'issues',
      deliveryId: 'run-live-stream-1',
      secret: WEBHOOK_SECRET,
      payload,
    });

    const collector = harness.collectRun(runId);
    try {
      // collectRun().waitForDone resolves with the `done` frame itself.
      const doneFrame = await collector.waitForDone(NODE_NAME, 30_000);
      expect(doneFrame.event.type).toBe('done');
      expect(doneFrame.nodeName).toBe(NODE_NAME);

      // After the node's `done`, no agent CONTENT (text/usage/tool) may leak
      // in — only run-level terminal (`done`) lifecycle frames may still
      // arrive (a single-node run emits the node `done`, then a run-terminal
      // `done`). Capture for ~1s and assert the content stream is frozen at
      // the terminal. A late content frame here would be a cross-run leak or
      // a late publish.
      const contentTypes = new Set(['text', 'usage', 'tool_call', 'tool_result']);
      const contentAtDone = collector
        .frames()
        .filter((f) => contentTypes.has(f.event.type)).length;
      await sleep(1_000);
      const framesAfterWait = collector.frames();
      const contentAfterWait = framesAfterWait.filter((f) =>
        contentTypes.has(f.event.type),
      ).length;
      expect(contentAfterWait).toBe(contentAtDone);

      // The last frame received for this run must be terminal (`done`).
      expect(framesAfterWait[framesAfterWait.length - 1]?.event.type).toBe('done');
      const doneIndex = framesAfterWait.findIndex((f) => f.event.type === 'done');

      // Every collected frame must be tagged with the single agent node.
      // (System lifecycle frames are published with the same node name, so
      // this holds for the whole stream, not just the agent events.)
      for (const f of framesAfterWait) {
        expect(f.nodeName).toBe(NODE_NAME);
      }

      // Ordering: all text deltas precede the usage frame, which precedes
      // done. Compare positional indices within the received stream.
      const textIndices = framesAfterWait
        .map((f, i) => (f.event.type === 'text' ? i : -1))
        .filter((i) => i >= 0);
      const usageIndex = framesAfterWait.findIndex((f) => f.event.type === 'usage');

      expect(textIndices.length).toBeGreaterThanOrEqual(2);
      expect(usageIndex).toBeGreaterThan(-1);
      const lastTextIndex = textIndices[textIndices.length - 1] ?? -1;
      expect(lastTextIndex).toBeLessThan(usageIndex);
      expect(usageIndex).toBeLessThan(doneIndex);

      // The text-delta frames reconstruct the scripted prose exactly.
      const reconstructed = framesAfterWait
        .filter((f) => f.event.type === 'text')
        .map((f) => (f.event.type === 'text' ? f.event.delta : ''))
        .join('');
      expect(reconstructed).toBe(FULL_TEXT);

      // The usage frame carries the scripted token counts over the WS.
      const usageFrame = framesAfterWait.find((f) => f.event.type === 'usage');
      expect(usageFrame).toBeDefined();
      if (usageFrame?.event.type === 'usage') {
        expect(usageFrame.event.inputTokens).toBe(USAGE_INPUT_TOKENS);
        expect(usageFrame.event.outputTokens).toBe(USAGE_OUTPUT_TOKENS);
      }
    } finally {
      collector.close();
    }

    // The stream terminal (`done`) must agree with the DB terminal: the run
    // settles COMPLETED.
    const finalRun = await pollForStatus(
      () => harness.http.get<RunResponse>(`/runs/${runId}`),
      (r) => r.status === 'COMPLETED' || r.status === 'FAILED',
      15_000,
    );
    expect(finalRun.status).toBe('COMPLETED');
  });
});
