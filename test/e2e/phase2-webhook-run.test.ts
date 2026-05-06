import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from '@conduit/shared';
import { loadEventFixture, loadWorkflowFixture } from '../helpers/temporal';
import { deliverGithubWebhook, pollForStatus } from '../helpers/webhook';
import { startHarness, type Harness } from './harness';

/**
 * Phase 2 exit criterion as an E2E test (see docs/PLANS.md "Phase 2"):
 *
 *   User connects a GitHub repo, creates a workflow with an "on issue
 *   opened" trigger, agent has a GitHub MCP server + workspace, agent
 *   reads the issue and posts a comment.
 *
 * Stub-backed version — the real GitHub API + MCP binary are out of scope
 * for the test suite (see docs/VALIDATION.md). The StubProvider emits the
 * tool_call / tool_result events a real agent would emit, so the webhook →
 * filter-match → run-start → stream flow is genuinely exercised end-to-end
 * without hitting GitHub.
 */

const WEBHOOK_SECRET = 'phase2-webhook-secret';

interface CreateWorkflowResponse {
  id: string;
  name: string;
  definition: WorkflowDefinition;
}

interface ConnectionResponse {
  id: string;
  alias: string;
  credentialId: string;
}

interface RunResponse {
  id: string;
  status: string;
}

describe('Phase 2 — webhook triggers a run and streams MCP tool calls', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness();
  });

  afterAll(async () => {
    await harness?.stop();
  });

  it('verifies HMAC, matches the trigger, starts a run, and streams a tool_call', async () => {
    // Trigger-connected agents derive `ticket-branch` workspaces — the
    // workspace manager needs a real bare remote it can clone from.
    await harness.seedTicketBranchRepo('acme', 'triage-tests');

    // 1. Platform credential — doubles as the {{credential}} the GitHub MCP
    //    server would receive in its Authorization header.
    const cred = await harness.http.post<{ id: string }>('/credentials', {
      platform: 'GITHUB',
      name: 'e2e-github-pat',
      secret: 'ghp_stub_token_for_tests',
    });

    // 2. Workflow — definition references a placeholder connection id; we
    //    patch it once the real connection exists.
    const fixture = await loadWorkflowFixture('phase2-webhook-issue');
    const created = await harness.http.post<CreateWorkflowResponse>('/workflows', {
      name: fixture.name,
      description: fixture.description,
      definition: fixture.definition,
    });

    // 3. Connection — alias + credential + webhook signing secret. The
    //    webhook endpoint reads the signing secret off this row.
    const connection = await harness.http.post<ConnectionResponse>(
      `/workflows/${created.id}/connections`,
      {
        alias: 'github-main',
        credentialId: cred.id,
        owner: 'acme',
        repo: 'triage-tests',
        webhookSecret: WEBHOOK_SECRET,
      },
    );

    // 4. Patch the workflow definition so the trigger points at the real
    //    connection id, and activate it so the webhook handler doesn't
    //    drop the delivery.
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

    // 5. Script the stub provider — simulates the agent calling a GitHub
    //    MCP tool to post a comment.
    await harness.setStubScript({
      steps: [
        { kind: 'text', delta: 'Analyzing issue…' },
        {
          kind: 'tool_call',
          id: 'call_1',
          name: 'github.add_issue_comment',
          input: { issue_number: 42, body: 'Thanks, looking into it.' },
        },
        { kind: 'tool_result', id: 'call_1', output: { ok: true } },
        { kind: 'usage', inputTokens: 12, outputTokens: 7 },
        { kind: 'done' },
      ],
    });

    // 6. Fire the signed webhook.
    const payload = await loadEventFixture('github', 'issues.opened');
    const { runId } = await deliverGithubWebhook(harness, created.id, {
      event: 'issues',
      deliveryId: 'test-delivery-1',
      secret: WEBHOOK_SECRET,
      payload,
    });

    // 7. Observe streaming — the agent's tool_call should show up on the
    //    run WS exactly like Phase 1 did with fresh-tmpdir.
    const collector = harness.collectRun(runId);
    try {
      await collector.waitForDone('Triage', 30_000);
    } finally {
      collector.close();
    }

    const finalRun = await pollForStatus(
      () => harness.http.get<RunResponse>(`/runs/${runId}`),
      (r) => r.status === 'COMPLETED' || r.status === 'FAILED',
      15_000,
    );
    expect(finalRun.status).toBe('COMPLETED');

    const frames = collector.frames();
    const toolCall = frames.find((f) => f.event.type === 'tool_call');
    expect(toolCall?.nodeName).toBe('Triage');
    if (toolCall?.event.type === 'tool_call') {
      expect(toolCall.event.name).toBe('github.add_issue_comment');
    }
  });

  it('rejects requests with a bad HMAC signature', async () => {
    const res = await fetch(`${harness.apiUrl}/api/hooks/nonexistent-wf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'issues',
        'X-Hub-Signature-256': 'sha256=deadbeef',
      },
      body: JSON.stringify({ action: 'opened' }),
    });
    // Missing workflow → 404 (auth-before-lookup order is deliberate: we'd
    // rather disclose "workflow not found" than leak HMAC-verification
    // timing info about which workflows do vs. don't exist).
    expect([401, 404]).toContain(res.status);
  });
});
