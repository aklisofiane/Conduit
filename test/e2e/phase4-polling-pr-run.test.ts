import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Connection, ScheduleClient } from '@temporalio/client';
import { workflowScheduleId, type WorkflowDefinition } from '@conduit/shared';
import { loadWorkflowFixture } from '../helpers/temporal';
import { startHarness, type Harness } from './harness';
import {
  repositoryPullRequestsResponse,
  startMockGithubGraphql,
  type MockGithubGraphql,
} from './mock-github';
import { TEST_STACK_ENV } from './stack';

async function waitFor<T>(check: () => Promise<T | null | false>, timeoutMs: number): Promise<T> {
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
 * Phase 4 PR-scope companion to `phase4-polling-run.test.ts`. Verifies the
 * end-to-end pipeline for `scope: 'pull_requests'` triggers without going
 * to GitHub:
 *
 *   1. `fetchRepositoryPullRequests` is hit (not the board path) — the mock
 *      GraphQL returns a `repository.pullRequests` shape.
 *   2. The `pr_state: 'ready_for_review'` filter excludes drafts.
 *   3. Set-diff dedup applies the same as for issues.
 *   4. Draft → ready transitions re-enter the matching set and re-fire,
 *      mirroring the Dev → Review → Dev re-entry primitive used by issue
 *      board loops.
 *   5. Each started run's `triggerEvent` carries `pull_request.detected`
 *      with the PR head ref populated.
 */
describe('Phase 4 PR scope — repo polling fires runs on PR set-diff', () => {
  let harness: Harness;
  let github: MockGithubGraphql;
  let scheduleClient: ScheduleClient;
  let connection: Connection;

  const waitForRunCount = (workflowId: string, expected: number): Promise<RunRow[]> =>
    waitFor(async () => {
      const rows = await harness.http.get<RunRow[]>(`/workflows/${workflowId}/runs`);
      return rows.length >= expected ? rows : null;
    }, 30_000);

  // The API freezes a human-readable slug into the schedule id, so the
  // deterministic handle is `poll-<slug>-<id>`. Read the frozen slug back
  // rather than recomputing it (the connection is patched in after create).
  const slugScheduleId = async (workflowId: string): Promise<string> => {
    const row = await harness.http.get<{ temporalSlug: string | null }>(`/workflows/${workflowId}`);
    return workflowScheduleId(workflowId, row.temporalSlug ?? undefined);
  };

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

  it('only ready PRs trigger runs; draft→ready re-entry re-fires', async () => {
    // Bare remote + the head refs the PRs in the canned response point at,
    // so the workspace manager can land on them without a real fetch.
    // Note: keeping at most one ready PR matched per cycle to side-step a
    // pre-existing workspace-manager bug — `fetchWithAuth` uses the global
    // `+refs/heads/*:refs/heads/*` refspec, which collides with a sibling
    // run holding a worktree on another existing remote branch ("refusing
    // to fetch into branch X checked out at Y"). Issue scope doesn't trip
    // this because `conduit/<id>-<slug>` branches don't exist remotely
    // until push. Tracked as a separate fix; not in scope here.
    await harness.seedTicketBranchRepo('acme', 'shop');
    await harness.seedRemoteBranch('acme', 'shop', 'feature-7');
    await harness.seedRemoteBranch('acme', 'shop', 'feature-8');

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

    const conn = await harness.http.post<ConnectionResponse>('/connections', {
      name: 'acme/shop',
      credentialId: cred.id,
      scope: { kind: 'github_repo', owner: 'acme', repo: 'shop' },
    });

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

    const scheduleHandle = scheduleClient.getHandle(await slugScheduleId(created.id));
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

    // ------------------------------------------------------------------
    // Cycle 1 — 1 draft + 1 ready PR. Filter is `pr_state: ready_for_review`
    //           so only the ready PR fires a run.
    // ------------------------------------------------------------------
    github.enqueue(
      repositoryPullRequestsResponse([
        { nodeId: 'PR_DRAFT_7', number: 7, isDraft: true, headRefName: 'feature-7' },
        { nodeId: 'PR_READY_8', number: 8, isDraft: false, headRefName: 'feature-8' },
      ]),
    );
    await scheduleHandle.trigger();
    const afterCycle1 = await waitForRunCount(created.id, 1);
    expect(afterCycle1).toHaveLength(1);
    expect(afterCycle1[0]?.trigger.payload?.projectItemNodeId).toBe('PR_READY_8');
    expect(afterCycle1[0]?.trigger.event).toBe('pull_request.detected');
    expect(afterCycle1[0]?.trigger.pr?.headRef).toBe('feature-8');
    expect(afterCycle1[0]?.trigger.pr?.baseRef).toBe('main');
    expect(afterCycle1[0]?.trigger.payload?.prState).toBe('ready_for_review');

    // The run the poller starts should converge to COMPLETED — catches a
    // wiring bug where the poll-started run never reaches the agent.
    await waitFor(async () => {
      const rows = await harness.http.get<RunRow[]>(`/workflows/${created.id}/runs`);
      return rows.every((r) => r.status === 'COMPLETED' || r.status === 'FAILED');
    }, 30_000);
    const completed1 = await harness.http.get<RunRow[]>(`/workflows/${created.id}/runs`);
    expect(completed1[0]?.status).toBe('COMPLETED');

    // ------------------------------------------------------------------
    // Cycle 2 — same shape. Set-diff dedup must keep run count at 1.
    // ------------------------------------------------------------------
    await scheduleHandle.trigger();
    const reqsAfterCycle1 = github.requestCount();
    await waitFor(() => Promise.resolve(github.requestCount() > reqsAfterCycle1), 15_000);
    await sleep(1500);
    const afterCycle2 = await harness.http.get<RunRow[]>(`/workflows/${created.id}/runs`);
    expect(afterCycle2).toHaveLength(1);

    // ------------------------------------------------------------------
    // Cycle 3 — PR #7 flips draft → ready. Set-diff sees it as new (it left
    //           the matching set, comes back), so exactly one new run fires.
    //           This is the same re-entry primitive issue board loops use,
    //           applied to PR draft↔ready transitions.
    // ------------------------------------------------------------------
    github.enqueue(
      repositoryPullRequestsResponse([
        { nodeId: 'PR_DRAFT_7', number: 7, isDraft: false, headRefName: 'feature-7' },
        { nodeId: 'PR_READY_8', number: 8, isDraft: false, headRefName: 'feature-8' },
      ]),
    );
    await scheduleHandle.trigger();
    const afterCycle3 = await waitForRunCount(created.id, 2);
    const startedIds = afterCycle3.map((r) => r.trigger.payload?.projectItemNodeId).sort();
    expect(startedIds).toEqual(['PR_DRAFT_7', 'PR_READY_8']);
  }, 180_000);
});
