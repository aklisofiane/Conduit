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
    event?: string;
    pr?: { headRef?: string; baseRef?: string };
    payload?: { projectItemNodeId?: string; prState?: string };
  };
  startedAt: string;
}

/**
 * PR-scope companion to `phase4-polling-run.test.ts`. Mirrors the same
 * scaffolding (mock GraphQL, schedule trigger, set-diff) but verifies the
 * scope split: PR items are kept, Issue items are filtered out, and the
 * `pr_state: 'ready_for_review'` filter excludes drafts. The poller is
 * tested in isolation — runs may fail downstream (the bare remote here
 * doesn't have the PR head refs seeded) but the run rows it writes carry
 * the trigger event we want to assert against.
 */
describe('Phase 4 PR scope — only ready PRs trigger runs', () => {
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
      extraEnv: { GITHUB_GRAPHQL_URL: github.url },
    });

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

  it('keeps PRs, drops issues, and applies pr_state: ready_for_review', async () => {
    await harness.seedTicketBranchRepo('acme', 'shop');

    const cred = await harness.http.post<{ id: string }>('/credentials', {
      platform: 'GITHUB',
      name: 'e2e-phase4-pr-pat',
      secret: 'ghp_stub_token_for_phase4_pr',
    });

    const fixture = await loadWorkflowFixture('phase4-polling-pr');
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

    const patched: WorkflowDefinition = {
      ...created.definition,
      triggers: created.definition.triggers.map((t) => ({
        ...t,
        connectionId: conn.id,
      })),
    };
    await harness.http.put(`/workflows/${created.id}`, {
      definition: patched,
      isActive: true,
    });

    const scheduleHandle = scheduleClient.getHandle(pollScheduleId(created.id));
    await waitFor(async () => {
      try {
        await scheduleHandle.describe();
        return true;
      } catch {
        return false;
      }
    }, 15_000);

    await harness.setStubScript({
      steps: [
        { kind: 'text', delta: 'reviewing pr' },
        { kind: 'usage', inputTokens: 1, outputTokens: 1 },
        { kind: 'done' },
      ],
    });

    // Mixed board: 1 issue, 1 draft PR, 2 ready-for-review PRs. The trigger
    // is `scope: 'pull_requests'` + `pr_state: 'ready_for_review'`, so only
    // the 2 ready PRs should fire runs.
    github.enqueue(
      projectBoardResponse([
        {
          itemId: 'PVTI_ISSUE',
          number: 99,
          title: 'an issue',
          status: 'Dev',
          contentType: 'issue',
        },
        {
          itemId: 'PVTI_PR_DRAFT',
          number: 7,
          title: 'WIP feature',
          status: 'Dev',
          contentType: 'pull_request',
          isDraft: true,
          headRefName: 'feature-7',
        },
        {
          itemId: 'PVTI_PR_READY_A',
          number: 8,
          title: 'Ready PR A',
          status: 'Dev',
          contentType: 'pull_request',
          isDraft: false,
          headRefName: 'feature-8',
        },
        {
          itemId: 'PVTI_PR_READY_B',
          number: 9,
          title: 'Ready PR B',
          status: 'Dev',
          contentType: 'pull_request',
          isDraft: false,
          headRefName: 'feature-9',
        },
      ]),
    );

    await scheduleHandle.trigger();
    const rows = await waitForRunCount(created.id, 2);

    // Only the two ready PRs fire runs. The issue is filtered out by scope;
    // the draft PR is filtered out by `pr_state: 'ready_for_review'`.
    expect(rows).toHaveLength(2);
    const startedItemIds = rows
      .map((r) => r.trigger.payload?.projectItemNodeId)
      .sort();
    expect(startedItemIds).toEqual(['PVTI_PR_READY_A', 'PVTI_PR_READY_B']);

    // Each run's trigger event should be `pull_request.detected`, carry the
    // PR head ref (so `ticket-branch` lands on it instead of `conduit/<…>`),
    // and tag `payload.prState = 'ready_for_review'` for downstream filters.
    for (const row of rows) {
      expect(row.trigger.event).toBe('pull_request.detected');
      expect(row.trigger.pr?.headRef).toMatch(/^feature-\d+$/);
      expect(row.trigger.pr?.baseRef).toBe('main');
      expect(row.trigger.payload?.prState).toBe('ready_for_review');
    }

    // ------------------------------------------------------------------
    // Cycle 2 — flip the draft PR to ready. Set-diff dedup should see it
    // as new (it left the matching set, comes back) and fire one more run.
    // ------------------------------------------------------------------
    github.enqueue(
      projectBoardResponse([
        {
          itemId: 'PVTI_ISSUE',
          number: 99,
          title: 'an issue',
          status: 'Dev',
          contentType: 'issue',
        },
        {
          itemId: 'PVTI_PR_DRAFT',
          number: 7,
          title: 'WIP feature',
          status: 'Dev',
          contentType: 'pull_request',
          isDraft: false,
          headRefName: 'feature-7',
        },
        {
          itemId: 'PVTI_PR_READY_A',
          number: 8,
          title: 'Ready PR A',
          status: 'Dev',
          contentType: 'pull_request',
          isDraft: false,
          headRefName: 'feature-8',
        },
        {
          itemId: 'PVTI_PR_READY_B',
          number: 9,
          title: 'Ready PR B',
          status: 'Dev',
          contentType: 'pull_request',
          isDraft: false,
          headRefName: 'feature-9',
        },
      ]),
    );
    await scheduleHandle.trigger();
    const afterCycle2 = await waitForRunCount(created.id, 3);
    const items2 = afterCycle2
      .map((r) => r.trigger.payload?.projectItemNodeId)
      .sort();
    expect(items2).toEqual([
      'PVTI_PR_DRAFT',
      'PVTI_PR_READY_A',
      'PVTI_PR_READY_B',
    ]);
  }, 120_000);
});
