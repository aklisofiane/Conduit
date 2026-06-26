import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from '@conduit/shared';
import { loadEventFixture, loadWorkflowFixture } from '../helpers/temporal';
import { deliverGithubWebhook, pollForStatus } from '../helpers/webhook';
import { startHarness, type Harness, type WsCollector } from './harness';

/**
 * E2E coverage for the *live-stream routing* of POST /api/runs/:id/rerun.
 *
 * `failure-and-cancel-run.test.ts` already proves rerun's HTTP contract (a
 * fresh run id, FAILED→COMPLETED, 409 on a non-FAILED run) — but only via
 * status polling. It never proves the rerun's *new* run actually streams.
 *
 * A rerun replays the original run's persisted `TriggerEvent` but mints a
 * brand-new `runId`. A wiring bug could publish the rerun's frames under the
 * OLD runId (or not at all), leaving the live UI dead for reruns. This test
 * adds the missing WS observation on top of the proven HTTP path:
 *
 *   1. A run is driven to FAILED (stub `shell` exits non-zero). POST
 *      /runs/:id/rerun returns a new run whose id differs from the failed run.
 *   2. A WS collector on the NEW runId receives a `done` frame and the new run
 *      reaches COMPLETED — the rerun streamed to its OWN /runs room.
 *   3. A WS collector on the ORIGINAL failed runId receives NO new frames
 *      after the rerun starts — frames are keyed to the fresh runId.
 *   4. The new run's frames carry the same agent node name as the original
 *      workflow's node.
 *   5. Re-issuing rerun against the now-COMPLETED new run is rejected with 409.
 */

interface CreateWorkflowResponse {
  id: string;
  definition: WorkflowDefinition;
}

interface RunResponse {
  id: string;
  status: string;
  error?: string | null;
}

const OWNER = 'acme';
const REPO = 'rerun-stream';

describe('Rerun live stream — fresh run streams to its own WS room', () => {
  let harness: Harness;
  let connectionId: string;

  beforeAll(async () => {
    harness = await startHarness();
    // Trigger-connected agents derive `ticket-branch` workspaces — they need a
    // real bare remote to clone from (no network in the suite).
    await harness.seedTicketBranchRepo(OWNER, REPO);

    const cred = await harness.http.post<{ id: string }>('/credentials', {
      platform: 'GITHUB',
      name: 'rerun-stream-github-pat',
      secret: 'ghp_stub_token_for_tests',
    });
    const connection = await harness.http.post<{ id: string }>('/connections', {
      name: `${OWNER}/${REPO}`,
      credentialId: cred.id,
      scope: { kind: 'github_repo', owner: OWNER, repo: REPO },
    });
    connectionId = connection.id;
  });

  afterAll(async () => {
    await harness?.stop();
  });

  /**
   * Create a fresh workflow off the phase2 fixture, wire its trigger to the
   * shared connection, set a per-workflow webhook secret, and activate it.
   * Returns the workflow id plus the agent node's name so the test can assert
   * the rerun's frames are tagged with the *same* node the original ran.
   */
  async function createWiredWorkflow(
    secret: string,
  ): Promise<{ workflowId: string; agentNodeName: string }> {
    const fixture = await loadWorkflowFixture('phase2-webhook-issue');
    const created = await harness.http.post<CreateWorkflowResponse>('/workflows', {
      name: fixture.name,
      description: fixture.description,
      definition: fixture.definition,
    });
    const patched: WorkflowDefinition = {
      ...created.definition,
      triggers: created.definition.triggers.map((t) => ({ ...t, connectionId })),
    };
    await harness.http.put(`/workflows/${created.id}`, { definition: patched, isActive: true });
    await harness.http.put(`/workflows/${created.id}/webhook-secret`, { secret });
    const agentNodeName = created.definition.nodes[0]!.name;
    return { workflowId: created.id, agentNodeName };
  }

  /** A clone of the issues.opened payload with a distinct issue number. */
  async function issuePayload(issueNumber: number): Promise<unknown> {
    const base = (await loadEventFixture('github', 'issues.opened')) as {
      issue: { number: number };
    };
    return { ...base, issue: { ...base.issue, number: issueNumber } };
  }

  it('routes the rerun run to its own WS room and leaves the original room silent', async () => {
    const secret = 'rerun-stream-secret';
    const { workflowId, agentNodeName } = await createWiredWorkflow(secret);

    // 1. First run fails — the agent hits a command that exits non-zero, so
    //    `runShell` throws and the node activity fails the run.
    await harness.setStubScript({
      steps: [
        { kind: 'text', delta: 'Investigating…' },
        { kind: 'shell', command: 'sh', args: ['-c', 'exit 1'] },
      ],
    });
    const { runId: failedRunId } = await deliverGithubWebhook(harness, workflowId, {
      event: 'issues',
      deliveryId: 'rerun-stream-1',
      secret,
      payload: await issuePayload(201),
    });
    const failed = await pollForStatus(
      () => harness.http.get<RunResponse>(`/runs/${failedRunId}`),
      (r) => r.status === 'COMPLETED' || r.status === 'FAILED' || r.status === 'CANCELLED',
      60_000,
    );
    expect(failed.status).toBe('FAILED');

    // 2. Subscribe to the ORIGINAL failed run's room and snapshot a baseline.
    //    The original execution is terminal, so its room must stay silent once
    //    the rerun (a different runId) starts publishing.
    const originalCollector: WsCollector = harness.collectRun(failedRunId);
    // Let the socket connect + drain any buffered frames before baselining.
    await new Promise((r) => setTimeout(r, 1_500));
    const originalBaseline = originalCollector.frames().length;

    // 3. Rerun replays the same persisted trigger event — but now the agent
    //    succeeds. The endpoint mints a brand-new run row with a fresh id.
    await harness.setStubScript({
      steps: [{ kind: 'text', delta: 'Fixed it this time.' }, { kind: 'done' }],
    });
    let newCollector: WsCollector | undefined;
    try {
      const newRun = await harness.http.post<RunResponse>(`/runs/${failedRunId}/rerun`);
      expect(newRun.id).toBeDefined();
      expect(newRun.id).not.toBe(failedRunId);

      // 4. The rerun must stream to its OWN room — a collector on the new id
      //    sees the `done` frame for the agent node.
      newCollector = harness.collectRun(newRun.id);
      const doneFrame = await newCollector.waitForDone(agentNodeName, 45_000);
      expect(doneFrame.nodeName).toBe(agentNodeName);

      const reran = await pollForStatus(
        () => harness.http.get<RunResponse>(`/runs/${newRun.id}`),
        (r) => r.status === 'COMPLETED' || r.status === 'FAILED',
        30_000,
      );
      expect(reran.status).toBe('COMPLETED');

      // Every frame the new collector saw is tagged with the agent node name —
      // proving the frames are this run's own, not bleed-through.
      const newFrames = newCollector.frames();
      expect(newFrames.length).toBeGreaterThan(0);
      expect(newFrames.every((f) => f.nodeName === agentNodeName)).toBe(true);

      // 5. The ORIGINAL failed run's room received no new frames while the
      //    rerun streamed — frames are keyed to the fresh runId, not the old.
      expect(originalCollector.frames().length).toBe(originalBaseline);

      // 6. The new run is COMPLETED — rerun only accepts FAILED runs, so a
      //    second rerun against it is rejected (http client throws on non-2xx).
      await expect(harness.http.post(`/runs/${newRun.id}/rerun`)).rejects.toThrow(/409/);
    } finally {
      newCollector?.close();
      originalCollector.close();
    }
  });
});
