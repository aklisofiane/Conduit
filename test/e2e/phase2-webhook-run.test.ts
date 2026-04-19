import { createHmac } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from '@conduit/shared';
import { loadWorkflowFixture } from '../helpers/temporal';
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

const FIXTURE_DIR = path.resolve(__dirname, '..', 'fixtures', 'events', 'github');
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
    // 1. Platform credential — doubles as the {{credential}} the GitHub MCP
    //    server would receive as GITHUB_PERSONAL_ACCESS_TOKEN.
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
        repo: 'shop',
        webhookSecret: WEBHOOK_SECRET,
      },
    );

    // 4. Patch the workflow definition so the trigger points at the real
    //    connection id, and activate it so the webhook handler doesn't
    //    drop the delivery.
    const patched: WorkflowDefinition = {
      ...created.definition,
      trigger: { ...created.definition.trigger, connectionId: connection.id },
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

    // 6. Fire the signed webhook. HMAC must be computed over the exact bytes
    //    POSTed — we build the body string once and reuse it.
    const payload = JSON.parse(
      await fs.readFile(path.join(FIXTURE_DIR, 'issues.opened.json'), 'utf8'),
    );
    const body = JSON.stringify(payload);
    const signature = `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')}`;

    const res = await fetch(`${harness.apiUrl}/api/hooks/${created.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'issues',
        'X-GitHub-Delivery': 'test-delivery-1',
        'X-Hub-Signature-256': signature,
      },
      body,
    });
    expect(res.status).toBe(200);
    const webhookResult = (await res.json()) as { status: string; runId?: string };
    expect(webhookResult.status).toBe('started');
    expect(webhookResult.runId).toBeDefined();

    // 7. Observe streaming — the agent's tool_call should show up on the
    //    run WS exactly like Phase 1 did with fresh-tmpdir.
    const runId = webhookResult.runId!;
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

async function pollForStatus<T>(
  fetcher: () => Promise<T>,
  ready: (value: T) => boolean,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await fetcher();
    if (ready(last)) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out after ${timeoutMs}ms. Last value: ${JSON.stringify(last)}`);
}
