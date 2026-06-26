import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from '@conduit/shared';
import { loadEventFixture, loadWorkflowFixture } from '../helpers/temporal';
import { deliverGithubWebhook, pollForStatus } from '../helpers/webhook';
import { startHarness, type Harness } from './harness';

/**
 * E2E coverage for the *unhappy* run lifecycle — the happy path is covered
 * one-per-phase (phase2–phase6), but nothing drove a run to FAILED or
 * CANCELLED end-to-end before. Both exercise the real
 * webhook → Temporal → activity → cleanup → DB-status path with StubProvider.
 *
 *   1. A node whose agent session throws (stub `shell` exits non-zero) lands
 *      the run in FAILED with an error string, via the workflow's
 *      `finally`-block cleanup.
 *   2. Cancelling a mid-flight run (POST /runs/:id/cancel) lands it in
 *      CANCELLED and stays there — the cancel write isn't clobbered by the
 *      workflow's cleanup (which Temporal skips for a cancelled workflow).
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
const REPO = 'shop';

describe('Run lifecycle — failure and cancellation', () => {
  let harness: Harness;
  let connectionId: string;

  beforeAll(async () => {
    harness = await startHarness();
    // Trigger-connected agents derive `ticket-branch` workspaces — they need a
    // real bare remote to clone from (no network in the suite).
    await harness.seedTicketBranchRepo(OWNER, REPO);

    const cred = await harness.http.post<{ id: string }>('/credentials', {
      platform: 'GITHUB',
      name: 'lifecycle-github-pat',
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
   * A fresh workflow per test keeps run dedup (keyed per workflow+ticket)
   * from soft-dropping the second test's delivery.
   */
  async function createWiredWorkflow(secret: string): Promise<string> {
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
    return created.id;
  }

  /** A clone of the issues.opened payload with a distinct issue number. */
  async function issuePayload(issueNumber: number): Promise<unknown> {
    const base = (await loadEventFixture('github', 'issues.opened')) as {
      issue: { number: number };
    };
    return { ...base, issue: { ...base.issue, number: issueNumber } };
  }

  it('marks the run FAILED when an agent node throws', async () => {
    const secret = 'lifecycle-fail-secret';
    const workflowId = await createWiredWorkflow(secret);

    // The agent "starts working" then hits a command that exits non-zero —
    // `runShell` throws, failing the session and the node activity.
    await harness.setStubScript({
      steps: [
        { kind: 'text', delta: 'Investigating…' },
        { kind: 'shell', command: 'sh', args: ['-c', 'exit 7'] },
      ],
    });

    const { runId } = await deliverGithubWebhook(harness, workflowId, {
      event: 'issues',
      deliveryId: 'lifecycle-fail-1',
      secret,
      payload: await issuePayload(101),
    });

    const finalRun = await pollForStatus(
      () => harness.http.get<RunResponse>(`/runs/${runId}`),
      (r) => r.status === 'COMPLETED' || r.status === 'FAILED' || r.status === 'CANCELLED',
      60_000,
    );
    expect(finalRun.status).toBe('FAILED');
    expect(finalRun.error).toBeTruthy();
  });

  it('cancels a mid-flight run and leaves it CANCELLED', async () => {
    const secret = 'lifecycle-cancel-secret';
    const workflowId = await createWiredWorkflow(secret);

    // A long delay keeps the node activity in-flight (RUNNING) so there's a
    // window to cancel before it can finish. The delay aborts on cancellation.
    await harness.setStubScript({
      steps: [
        { kind: 'text', delta: 'Working for a while…' },
        { kind: 'delay', ms: 60_000 },
        { kind: 'done' },
      ],
    });

    const { runId } = await deliverGithubWebhook(harness, workflowId, {
      event: 'issues',
      deliveryId: 'lifecycle-cancel-1',
      secret,
      payload: await issuePayload(102),
    });

    // Wait until the run is actually RUNNING (Temporal started, node in-flight)
    // before cancelling — cancelling a PENDING run is a different code path.
    await pollForStatus(
      () => harness.http.get<RunResponse>(`/runs/${runId}`),
      (r) => r.status === 'RUNNING',
      45_000,
    );

    await harness.http.post(`/runs/${runId}/cancel`);

    const cancelled = await pollForStatus(
      () => harness.http.get<RunResponse>(`/runs/${runId}`),
      (r) => r.status === 'CANCELLED' || r.status === 'COMPLETED' || r.status === 'FAILED',
      30_000,
    );
    expect(cancelled.status).toBe('CANCELLED');

    // It must *stay* cancelled — a late cleanup write must not flip it to
    // FAILED/COMPLETED. Give any straggler activity a moment, then re-read.
    await new Promise((r) => setTimeout(r, 3_000));
    const stable = await harness.http.get<RunResponse>(`/runs/${runId}`);
    expect(stable.status).toBe('CANCELLED');
  });

  it('reruns a FAILED run to success, and rejects rerunning a non-FAILED run', async () => {
    const secret = 'lifecycle-rerun-secret';
    const workflowId = await createWiredWorkflow(secret);

    // First run fails.
    await harness.setStubScript({
      steps: [{ kind: 'shell', command: 'sh', args: ['-c', 'exit 1'] }],
    });
    const { runId: failedRunId } = await deliverGithubWebhook(harness, workflowId, {
      event: 'issues',
      deliveryId: 'lifecycle-rerun-1',
      secret,
      payload: await issuePayload(103),
    });
    await pollForStatus(
      () => harness.http.get<RunResponse>(`/runs/${failedRunId}`),
      (r) => r.status === 'FAILED',
      60_000,
    );

    // Rerun replays the same persisted trigger event — but now the agent
    // succeeds. The endpoint returns a brand-new run row.
    await harness.setStubScript({
      steps: [{ kind: 'text', delta: 'Fixed it this time.' }, { kind: 'done' }],
    });
    const newRun = await harness.http.post<RunResponse>(`/runs/${failedRunId}/rerun`);
    expect(newRun.id).toBeDefined();
    expect(newRun.id).not.toBe(failedRunId);

    const reran = await pollForStatus(
      () => harness.http.get<RunResponse>(`/runs/${newRun.id}`),
      (r) => r.status === 'COMPLETED' || r.status === 'FAILED',
      60_000,
    );
    expect(reran.status).toBe('COMPLETED');

    // The new run is COMPLETED — rerun only accepts FAILED runs, so this is
    // rejected (the http client throws on the non-2xx response).
    await expect(harness.http.post(`/runs/${newRun.id}/rerun`)).rejects.toThrow(/409/);
  });
});
