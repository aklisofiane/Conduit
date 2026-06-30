import { PrismaClient } from '@conduit/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from '@conduit/shared';
import { loadEventFixture, loadWorkflowFixture } from '../helpers/temporal';
import { deliverGithubWebhook, pollForStatus } from '../helpers/webhook';
import { startHarness, type Harness } from './harness';

/**
 * Token-cost-per-run, phase 1 (.specs/token-cost-per-run.md): a completed
 * agent node snapshots its dollar cost (`NodeRun.costUsd` + `priceSnapshot`)
 * from the price resolved for `node.model`, and run finalization rolls the
 * per-node tokens + cost up into the `WorkflowRun` aggregate columns.
 *
 * Stub-backed like the other E2E specs — the StubProvider replays a scripted
 * `usage` frame with known token counts, but git, the workspace manager, the
 * Temporal workflow, and both DB write sites (run-agent-node completion +
 * cleanup-run rollup) run for real. The cost columns aren't exposed over the
 * API yet (that's phase 2/3), so we assert them with a direct DB read against
 * the same test Postgres the worker writes to.
 *
 * The node model is patched to a *known* priced model (`claude-opus-4-8`) —
 * the shared fixture ships `stub-model`, which has no default price and would
 * (correctly) leave cost null.
 */

const WEBHOOK_SECRET = 'run-cost-secret';
const NODE_NAME = 'Triage';
const MODEL = 'claude-opus-4-8'; // MODEL_PRICING default: $15 in / $75 out per 1M.

const USAGE_INPUT_TOKENS = 137;
const USAGE_OUTPUT_TOKENS = 41;

// Expected snapshot-at-write cost from the defaults above.
const EXPECTED_COST =
  (USAGE_INPUT_TOKENS / 1_000_000) * 15 + (USAGE_OUTPUT_TOKENS / 1_000_000) * 75;

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

describe('Run cost — per-node snapshot + run rollup land in the DB', () => {
  let harness: Harness;
  let prisma: PrismaClient;

  beforeAll(async () => {
    harness = await startHarness();
    // Same test DB the worker child process writes to (test/e2e/stack.ts).
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: 'postgresql://conduit:conduit@localhost:55432/conduit_test?schema=public',
        },
      },
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await harness?.stop();
  });

  it('writes costUsd/priceSnapshot per node and totals on the run', async () => {
    await harness.seedTicketBranchRepo('acme', 'cost-tests');

    const cred = await harness.http.post<{ id: string }>('/credentials', {
      platform: 'GITHUB',
      name: 'e2e-cost-pat',
      secret: 'ghp_stub_token_for_tests',
    });

    const fixture = await loadWorkflowFixture('phase2-webhook-issue');
    const created = await harness.http.post<CreateWorkflowResponse>('/workflows', {
      name: fixture.name,
      description: fixture.description,
      definition: fixture.definition,
    });

    const connection = await harness.http.post<ConnectionResponse>('/connections', {
      name: 'acme/cost-tests',
      credentialId: cred.id,
      scope: { kind: 'github_repo', owner: 'acme', repo: 'cost-tests' },
    });

    // Point the trigger at the real connection and pin the node to a priced
    // model so the cost path resolves a non-null default price.
    const patched: WorkflowDefinition = {
      ...created.definition,
      triggers: created.definition.triggers.map((t) => ({ ...t, connectionId: connection.id })),
      nodes: created.definition.nodes.map((n) => ({ ...n, model: MODEL })),
    };
    await harness.http.put(`/workflows/${created.id}`, { definition: patched, isActive: true });
    await harness.http.put(`/workflows/${created.id}/webhook-secret`, { secret: WEBHOOK_SECRET });

    await harness.setStubScript({
      steps: [
        { kind: 'text', delta: 'Triaging.' },
        { kind: 'usage', inputTokens: USAGE_INPUT_TOKENS, outputTokens: USAGE_OUTPUT_TOKENS },
        { kind: 'done' },
      ],
    });

    const payload = await loadEventFixture('github', 'issues.opened');
    const { runId } = await deliverGithubWebhook(harness, created.id, {
      event: 'issues',
      deliveryId: 'run-cost-1',
      secret: WEBHOOK_SECRET,
      payload,
    });

    const finalRun = await pollForStatus(
      () => harness.http.get<RunResponse>(`/runs/${runId}`),
      (r) => r.status === 'COMPLETED' || r.status === 'FAILED',
      30_000,
    );
    expect(finalRun.status).toBe('COMPLETED');

    // Per-node snapshot: cost frozen from the resolved default price.
    const nodeRun = await prisma.nodeRun.findUniqueOrThrow({
      where: { runId_nodeName: { runId, nodeName: NODE_NAME } },
    });
    expect(Number(nodeRun.costUsd)).toBeCloseTo(EXPECTED_COST, 6);
    expect(nodeRun.priceSnapshot).toEqual({ inputPerM: 15, outputPerM: 75, source: 'default' });

    // Run rollup: tokens summed from NodeRun.usage, cost summed from costUsd.
    const workflowRun = await prisma.workflowRun.findUniqueOrThrow({ where: { id: runId } });
    expect(workflowRun.totalInputTokens).toBe(USAGE_INPUT_TOKENS);
    expect(workflowRun.totalOutputTokens).toBe(USAGE_OUTPUT_TOKENS);
    expect(Number(workflowRun.totalCostUsd)).toBeCloseTo(EXPECTED_COST, 6);
  });
});
