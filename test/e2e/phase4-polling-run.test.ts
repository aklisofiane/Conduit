import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Connection, ScheduleClient } from '@temporalio/client';
import { pollScheduleId, type WorkflowDefinition } from '@conduit/shared';
import { loadWorkflowFixture } from '../helpers/temporal';
import { startHarness, type Harness } from './harness';
import {
  projectBoardResponse,
  startMockGithubGraphql,
  type MockGithubGraphql,
} from './mock-github';
import { TEST_STACK_ENV } from './stack';

/**
 * Poll `check` until it returns a truthy value (cast back to T) or the
 * deadline elapses. Lets helpers return `null`/`false` to mean "not ready
 * yet" without throwing.
 */
async function waitFor<T>(
  check: () => Promise<T | null | false>,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result !== null && result !== false) return result;
    await sleep(200);
  }
  throw new Error(`waitFor: timed out after ${timeoutMs}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Phase 4 exit criterion as an E2E test (see docs/PLANS.md "Phase 4"):
 *
 *   User configures a polling trigger on status = "Dev", workflow runs
 *   whenever an issue enters that column.
 *
 * Verifies the full polling pipeline without hitting GitHub:
 *
 *   1. A workflow saved with a polling trigger registers a Temporal Schedule
 *      (the schedule id is deterministic — `pollScheduleId(workflowId)`).
 *   2. Each schedule tick runs `pollBoardActivity`, which queries the
 *      platform (redirected to our mock via `GITHUB_GRAPHQL_URL`).
 *   3. `PollSnapshot` set-diff only starts `agentWorkflow`s for items that
 *      are *new* to the matching set. Re-entry (item leaves, returns)
 *      triggers again — this is the board-cycle primitive.
 *   4. Filter values (Projects v2 `Status`) are applied on the poller side
 *      so the agent never sees items that shouldn't trigger it.
 *
 * Runs are driven by `ScheduleHandle.trigger()` so we don't sit around
 * waiting for wall-clock intervals.
 */

interface CreateWorkflowResponse {
  id: string;
  name: string;
  definition: WorkflowDefinition;
}

interface ConnectionResponse {
  id: string;
}

interface RunRow {
  id: string;
  status: string;
  trigger: {
    payload?: { projectItemNodeId?: string; status?: string };
  };
  startedAt: string;
}

describe('Phase 4 — polling trigger fires runs on board set-diff', () => {
  let harness: Harness;
  let github: MockGithubGraphql;
  let scheduleClient: ScheduleClient;
  let connection: Connection;

  const waitForRunCount = (workflowId: string, expected: number): Promise<RunRow[]> =>
    waitFor(async () => {
      const rows = await harness.http.get<RunRow[]>(`/workflows/${workflowId}/runs`);
      return rows.length >= expected ? rows : null;
    }, 30_000);

  beforeAll(async () => {
    github = await startMockGithubGraphql();

    harness = await startHarness({
      extraEnv: {
        GITHUB_GRAPHQL_URL: github.url,
      },
    });

    // Direct Temporal client used only to `.trigger()` the schedule — the
    // interval in the fixture is 1 hour so wall-clock polls don't fire.
    connection = await Connection.connect({ address: TEST_STACK_ENV.TEMPORAL_ADDRESS });
    scheduleClient = new ScheduleClient({
      connection,
      namespace: TEST_STACK_ENV.TEMPORAL_NAMESPACE,
    });
  }, 180_000);

  afterAll(async () => {
    await connection?.close().catch(() => undefined);
    await harness?.stop().catch(() => undefined);
    await github?.close().catch(() => undefined);
  });

  it('only starts a run for items that are new to the matching set', async () => {
    // 1. Credential + workflow + connection — same wiring pattern as Phase 2.
    const cred = await harness.http.post<{ id: string }>('/credentials', {
      platform: 'GITHUB',
      name: 'e2e-phase4-pat',
      secret: 'ghp_stub_token_for_phase4',
    });

    const fixture = await loadWorkflowFixture('phase4-polling');
    const created = await harness.http.post<CreateWorkflowResponse>('/workflows', {
      name: fixture.name,
      description: fixture.description,
      definition: fixture.definition,
    });

    const conn = await harness.http.post<ConnectionResponse>(
      `/workflows/${created.id}/connections`,
      {
        alias: 'github-main',
        credentialId: cred.id,
        owner: 'acme',
        repo: 'shop',
      },
    );

    // Activate the workflow — the API should register the Temporal Schedule
    // on save. `isActive: true` is required so the poll activity won't
    // short-circuit its early `!wf.isActive` check.
    const patched: WorkflowDefinition = {
      ...created.definition,
      trigger: { ...created.definition.trigger, connectionId: conn.id },
    };
    await harness.http.put(`/workflows/${created.id}`, {
      definition: patched,
      isActive: true,
    });

    // Give the API a moment to finish registering the schedule before we
    // try to grab its handle. The upsert is fire-and-forget from the write
    // path (by design — schedule sync doesn't block the DB update), so a
    // short poll is the right shape here.
    const scheduleHandle = scheduleClient.getHandle(pollScheduleId(created.id));
    await waitFor(async () => {
      try {
        await scheduleHandle.describe();
        return true;
      } catch {
        return false;
      }
    }, 15_000);

    // Stub script — any new poll-triggered run uses this. One text frame +
    // done is enough; we're testing the poller, not the agent.
    await harness.setStubScript({
      steps: [
        { kind: 'text', delta: 'working' },
        { kind: 'usage', inputTokens: 1, outputTokens: 1 },
        { kind: 'done' },
      ],
    });

    // ------------------------------------------------------------------
    // Cycle 1 — two items in Dev, one in Todo. Expect 2 runs to start.
    // ------------------------------------------------------------------
    github.enqueue(
      projectBoardResponse([
        { itemId: 'PVTI_A', number: 10, title: 'A', status: 'Dev' },
        { itemId: 'PVTI_B', number: 11, title: 'B', status: 'Dev' },
        { itemId: 'PVTI_C', number: 12, title: 'C', status: 'Todo' },
      ]),
    );
    await scheduleHandle.trigger();
    const afterCycle1 = await waitForRunCount(created.id, 2);
    expect(afterCycle1.map((r) => r.trigger.payload?.projectItemNodeId).sort()).toEqual([
      'PVTI_A',
      'PVTI_B',
    ]);

    // Every started run should converge to COMPLETED once the StubProvider
    // finishes — catching a wiring bug where the poll-started run never
    // reaches the worker's agentWorkflow.
    await waitFor(async () => {
      const rows = await harness.http.get<RunRow[]>(`/workflows/${created.id}/runs`);
      return rows.every((r) => r.status === 'COMPLETED' || r.status === 'FAILED');
    }, 30_000);
    const completed1 = await harness.http.get<RunRow[]>(`/workflows/${created.id}/runs`);
    for (const r of completed1) {
      expect(r.status).toBe('COMPLETED');
    }

    // ------------------------------------------------------------------
    // Cycle 2 — same board state. No new runs should start.
    // ------------------------------------------------------------------
    await scheduleHandle.trigger();
    // Give the activity time to poll + write snapshot. We can't `waitForRunCount`
    // for a negative; instead wait for another GraphQL hit, then assert.
    const reqsAfterCycle1 = github.requestCount();
    await waitFor(() => Promise.resolve(github.requestCount() > reqsAfterCycle1), 15_000);
    // Short settle — any errant run-start would have created a PENDING row
    // by now.
    await sleep(1500);
    const afterCycle2 = await harness.http.get<RunRow[]>(`/workflows/${created.id}/runs`);
    expect(afterCycle2).toHaveLength(2);

    // ------------------------------------------------------------------
    // Cycle 3 — item B leaves Dev, item D enters. Expect exactly one new
    //           run (for D). A is still in Dev — must NOT re-fire.
    // ------------------------------------------------------------------
    github.enqueue(
      projectBoardResponse([
        { itemId: 'PVTI_A', number: 10, title: 'A', status: 'Dev' },
        { itemId: 'PVTI_B', number: 11, title: 'B', status: 'Review' },
        { itemId: 'PVTI_D', number: 13, title: 'D', status: 'Dev' },
      ]),
    );
    await scheduleHandle.trigger();
    const afterCycle3 = await waitForRunCount(created.id, 3);
    const startedIds = afterCycle3.map((r) => r.trigger.payload?.projectItemNodeId).sort();
    expect(startedIds).toEqual(['PVTI_A', 'PVTI_B', 'PVTI_D']);
    // The newest run — sort by startedAt — should be the one for D.
    const newest = [...afterCycle3].sort((a, b) =>
      a.startedAt < b.startedAt ? 1 : -1,
    )[0];
    expect(newest?.trigger.payload?.projectItemNodeId).toBe('PVTI_D');

    // ------------------------------------------------------------------
    // Cycle 4 — re-entry. B comes back to Dev. Set-diff dedup *must*
    //           treat it as new because it left the matching set in
    //           cycle 3. This is what makes board loops work.
    // ------------------------------------------------------------------
    github.enqueue(
      projectBoardResponse([
        { itemId: 'PVTI_A', number: 10, title: 'A', status: 'Dev' },
        { itemId: 'PVTI_B', number: 11, title: 'B', status: 'Dev' },
        { itemId: 'PVTI_D', number: 13, title: 'D', status: 'Dev' },
      ]),
    );
    await scheduleHandle.trigger();
    const afterCycle4 = await waitForRunCount(created.id, 4);
    const byItem: Record<string, number> = {};
    for (const r of afterCycle4) {
      const id = r.trigger.payload?.projectItemNodeId;
      if (id) byItem[id] = (byItem[id] ?? 0) + 1;
    }
    // A fired once (cycle 1), B fired twice (cycle 1 + cycle 4 re-entry),
    // D fired once (cycle 3). This exact shape is what proves the
    // Dev → Review → Dev loop primitive works.
    expect(byItem).toEqual({ PVTI_A: 1, PVTI_B: 2, PVTI_D: 1 });
  }, 120_000);

  it('deletes the schedule when the workflow is deleted', async () => {
    // Fresh workflow so this test doesn't interfere with the one above.
    const fixture = await loadWorkflowFixture('phase4-polling');
    const created = await harness.http.post<CreateWorkflowResponse>('/workflows', {
      name: `${fixture.name} (cleanup)`,
      description: fixture.description,
      definition: fixture.definition,
    });

    const handle = scheduleClient.getHandle(pollScheduleId(created.id));
    // Schedule should appear after the create path completes its sync.
    await waitFor(
      () =>
        handle
          .describe()
          .then(() => true)
          .catch(() => false),
      15_000,
    );

    await harness.http.del(`/workflows/${created.id}`);

    // And disappear after delete — describe() must reject.
    await waitFor(
      () =>
        handle
          .describe()
          .then(() => false)
          .catch(() => true),
      15_000,
    );
  }, 60_000);
});

