import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Connection, ScheduleClient } from '@temporalio/client';
import {
  enumerateConnectionSlots,
  workflowScheduleId,
  type WorkflowDefinition,
} from '@conduit/shared';
import { startHarness, type Harness } from './harness';
import {
  projectBoardResponse,
  startMockGithubGraphql,
  type MockGithubGraphql,
} from './mock-github';
import { TEST_STACK_ENV } from './stack';

/**
 * Closes the gap between "template instantiated" (Phase 6) and "templated
 * workflow produces a COMPLETED run". `POST /workflows/from-template/analyze`
 * binds a fresh repo + board, resolves every `<alias>` placeholder into a real
 * Connection cuid, and freezes a poll schedule — but Phase 6 never proves the
 * bound graph can actually RUN.
 *
 * Here we drive the instantiated 3-node SEQUENTIAL chain (Research → Review →
 * Publish) end-to-end via the same mock-board + `schedule.trigger()` rig as
 * `phase4-polling-run`, and assert:
 *
 *   1. The instantiated definition has no `<...>` placeholders left.
 *   2. A board item in `status = Todo` starts exactly one run for that item.
 *   3. The run converges to COMPLETED with each node scripted via a byPrompt
 *      bundle keyed on its preset's instructions.
 *   4. Run detail shows Research / Review / Publish all COMPLETED.
 *   5. Sequential `.conduit/` propagation on the inherited workspace —
 *      Publish's summary is literally built from the upstream nodes' output
 *      (the sequential analogue of Phase 3's parallel fan-out).
 *   6. Every node shares the same inherited `output.workspacePath`
 *      (no branched worktree — distinct from Phase 3's fan-out).
 *   7. A second poll tick with the item still in Todo starts no duplicate run.
 */

interface CreatedTemplateResult {
  templateId: string;
  workflows: { id: string; name: string }[];
}

interface WorkflowRow {
  id: string;
  name: string;
  definition: WorkflowDefinition;
  isActive: boolean;
  temporalSlug: string | null;
}

interface RunRow {
  id: string;
  status: string;
  trigger: {
    payload?: { projectItemNodeId?: string; status?: string };
  };
  startedAt: string;
}

interface RunDetail {
  id: string;
  status: string;
  nodes: Array<{
    nodeName: string;
    status: string;
    output: { workspacePath?: string; isBranchedWorktree?: boolean } | null;
    workspacePath: string | null;
    conduitSummary: string | null;
    error: string | null;
  }>;
}

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

describe('Template — instantiate `analyze` then run the bound 3-node chain', () => {
  let harness: Harness;
  let github: MockGithubGraphql;
  let connection: Connection;
  let scheduleClient: ScheduleClient;

  beforeAll(async () => {
    github = await startMockGithubGraphql();
    harness = await startHarness({
      extraEnv: { GITHUB_GRAPHQL_URL: github.url },
    });
    // Direct Temporal client — used only to `.trigger()` the poll schedule so
    // we don't wait on the 60s wall-clock interval baked into the template.
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

  it('runs Research → Review → Publish to COMPLETED on the inherited workspace', async () => {
    // The `issues`/board trigger derives `ticket-branch` workspaces — even a
    // poll-fired run needs a real bare remote to clone from. The mock board
    // reports items under `acme/shop`, so bind + seed the same repo.
    await harness.seedTicketBranchRepo('acme', 'shop', {
      'src/index.ts': 'export const version = "0.1.0";\n',
    });

    const cred = await harness.http.post<{ id: string }>('/credentials', {
      platform: 'GITHUB',
      name: 'tmpl-run-pat',
      secret: 'ghp_stub_template_run',
    });

    // ------------------------------------------------------------------
    // Instantiate the catalog `analyze` template with brand-new bindings.
    // ------------------------------------------------------------------
    const result = await harness.http.post<CreatedTemplateResult>(
      '/workflows/from-template/analyze',
      {
        bindings: {
          'github-repo': {
            mode: 'new',
            name: 'acme/shop',
            credentialId: cred.id,
            scope: { kind: 'github_repo', owner: 'acme', repo: 'shop' },
          },
          'github-board': {
            mode: 'new',
            name: 'acme · project #1',
            credentialId: cred.id,
            scope: {
              kind: 'github_projects_v2',
              ownerType: 'org',
              owner: 'acme',
              number: 1,
            },
          },
        },
      },
    );
    expect(result.workflows).toHaveLength(1);
    const workflowId = result.workflows[0]!.id;

    // Case 1 — every connection slot resolved to a real cuid, no placeholders.
    const wf = await harness.http.get<WorkflowRow>(`/workflows/${workflowId}`);
    const def = wf.definition;
    const slots = [...enumerateConnectionSlots(def)];
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(slot.value, `slot ${slot.expectedScopeKind} is empty`).toBeTruthy();
      expect(slot.value, `slot ${slot.expectedScopeKind} unresolved`).not.toMatch(/^</);
      expect(slot.value).toMatch(/^[a-z0-9]+$/);
    }
    expect(def.triggers[0]!.type).toBe('issues');

    // ------------------------------------------------------------------
    // Activate the workflow so the poll activity doesn't short-circuit on
    // `!wf.isActive`. The schedule was already frozen at template create.
    // ------------------------------------------------------------------
    await harness.http.put(`/workflows/${workflowId}`, {
      definition: def,
      isActive: true,
    });

    const scheduleId = workflowScheduleId(workflowId, wf.temporalSlug ?? undefined);
    const scheduleHandle = scheduleClient.getHandle(scheduleId);
    await waitFor(
      () =>
        scheduleHandle
          .describe()
          .then(() => true)
          .catch(() => false),
      15_000,
    );

    // ------------------------------------------------------------------
    // Scripted sessions — one per node, dispatched by a unique substring of
    // each node's preset instructions (`req.systemPrompt`). The Publish node
    // literally cats the upstream `.conduit/*.md` into its own summary, so a
    // COMPLETED Publish proves sequential propagation on the shared workspace.
    // ------------------------------------------------------------------
    await harness.setStubBundle({
      byPrompt: [
        {
          match: 'You are a Research agent',
          session: {
            turns: [
              { steps: [{ kind: 'text', delta: 'Researching the issue…' }, { kind: 'done' }] },
              {
                steps: [
                  {
                    kind: 'write-file',
                    path: '.conduit/Research.md',
                    content:
                      '# Research\n\nSENTINEL_RESEARCH: checkout crash root cause identified.\n',
                  },
                  { kind: 'done' },
                ],
              },
            ],
          },
        },
        {
          match: 'You are a Plan Reviewer agent',
          session: {
            turns: [
              { steps: [{ kind: 'text', delta: 'Reviewing the plan…' }, { kind: 'done' }] },
              {
                steps: [
                  {
                    kind: 'write-file',
                    path: '.conduit/Review.md',
                    content: '# Review\n\nSENTINEL_REVIEW: plan approved, no blocking gaps.\n',
                  },
                  { kind: 'done' },
                ],
              },
            ],
          },
        },
        {
          match: 'You are a Publish agent',
          session: {
            turns: [
              { steps: [{ kind: 'text', delta: 'Publishing the analysis…' }, { kind: 'done' }] },
              {
                // Build Publish's summary from the upstream nodes' output. If
                // either upstream file is missing from the inherited workspace
                // the redirect fails (cat exits non-zero) → session error →
                // node FAILED → run FAILED. COMPLETED therefore proves the
                // sequential `.conduit/` propagation.
                steps: [
                  {
                    kind: 'shell',
                    command: 'sh',
                    args: [
                      '-c',
                      'cat .conduit/Research.md .conduit/Review.md > .conduit/Publish.md',
                    ],
                  },
                  { kind: 'done' },
                ],
              },
            ],
          },
        },
      ],
    });

    // ------------------------------------------------------------------
    // Cycle 1 — one item in Todo. Expect exactly one run started for it.
    // ------------------------------------------------------------------
    github.enqueue(
      projectBoardResponse([
        { itemId: 'PVTI_TODO_1', number: 42, title: 'Crash on checkout', status: 'Todo' },
        { itemId: 'PVTI_DONE_1', number: 43, title: 'Already shipped', status: 'Done' },
      ]),
    );
    await scheduleHandle.trigger();

    const runs = await waitFor(async () => {
      const rows = await harness.http.get<RunRow[]>(`/workflows/${workflowId}/runs`);
      return rows.length >= 1 ? rows : null;
    }, 30_000);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.trigger.payload?.projectItemNodeId).toBe('PVTI_TODO_1');
    const runId = runs[0]!.id;

    // ------------------------------------------------------------------
    // The run converges to COMPLETED — exercises the frozen poll wiring, the
    // bound connection ids, and the full Research → Review → Publish graph.
    // ------------------------------------------------------------------
    const finalRun = await waitFor(async () => {
      const detail = await harness.http.get<RunDetail>(`/runs/${runId}`);
      return detail.status === 'COMPLETED' || detail.status === 'FAILED' ? detail : null;
    }, 120_000);
    expect(finalRun.status).toBe('COMPLETED');

    // Case: run detail shows all three nodes COMPLETED.
    const byName = new Map(finalRun.nodes.map((n) => [n.nodeName, n]));
    const research = byName.get('Research')!;
    const review = byName.get('Review')!;
    const publish = byName.get('Publish')!;
    expect(research).toBeDefined();
    expect(review).toBeDefined();
    expect(publish).toBeDefined();
    for (const n of finalRun.nodes) {
      expect(n.status, `${n.nodeName} not completed: ${n.error ?? ''}`).toBe('COMPLETED');
    }

    // Case: downstream Publish's summary is built from upstream output —
    // sequential `.conduit/` propagation on the inherited workspace.
    expect(publish.conduitSummary).toBeTruthy();
    expect(publish.conduitSummary).toMatch(/SENTINEL_RESEARCH/);
    expect(publish.conduitSummary).toMatch(/SENTINEL_REVIEW/);

    // Case: each node shares the same inherited workspace path — a linear
    // chain inherits rather than branching (unlike Phase 3's parallel
    // siblings, which get `isBranchedWorktree: true` on distinct paths).
    const inheritedPath = research.output?.workspacePath;
    expect(inheritedPath).toBeTruthy();
    expect(review.output?.workspacePath).toBe(inheritedPath);
    expect(publish.output?.workspacePath).toBe(inheritedPath);
    for (const n of finalRun.nodes) {
      expect(n.output?.isBranchedWorktree ?? false).toBe(false);
    }

    // ------------------------------------------------------------------
    // Cycle 2 — same board state. The set-diff dedup must NOT start a
    // duplicate run for the still-Todo item.
    // ------------------------------------------------------------------
    const reqsBefore = github.requestCount();
    await scheduleHandle.trigger();
    // Wait for the poll to have actually hit GraphQL, then settle — any errant
    // run-start would have created a fresh row by now.
    await waitFor(() => Promise.resolve(github.requestCount() > reqsBefore), 15_000);
    await sleep(1500);
    const afterCycle2 = await harness.http.get<RunRow[]>(`/workflows/${workflowId}/runs`);
    expect(afterCycle2).toHaveLength(1);
  }, 240_000);
});
