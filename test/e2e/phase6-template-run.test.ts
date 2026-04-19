import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Connection, ScheduleClient } from '@temporalio/client';
import { pollScheduleId, type WorkflowDefinition } from '@conduit/shared';
import { startHarness, type Harness } from './harness';
import { TEST_STACK_ENV } from './stack';

/**
 * Phase 6 exit criterion: user picks a template, binds their connection,
 * workflows are created atomically and ready to run.
 *
 * Verifies:
 *
 *   1. `GET /api/templates` lists the v1 templates with placeholder metadata.
 *   2. `POST /api/workflows/from-template/:id` for the `board-loop` bundle
 *      creates *both* workflows in a single call with the `<github>`
 *      placeholder resolved to a real connection id on each.
 *   3. The resolved definitions reference real connection cuids in every
 *      connection slot (trigger, mcpServers, workspace).
 *   4. Polling schedules are upserted for polling-mode templates (here
 *      both Worker and Critic are polling).
 *   5. A single-workflow template (`analyze`) works the same way.
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
}

interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  workflowCount: number;
  placeholders: string[];
}

async function waitFor<T>(
  check: () => Promise<T | null | false>,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result !== null && result !== false) return result;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`waitFor: timed out after ${timeoutMs}ms`);
}

describe('Phase 6 — create workflows from template', () => {
  let harness: Harness;
  let connection: Connection;
  let scheduleClient: ScheduleClient;

  beforeAll(async () => {
    harness = await startHarness();
    connection = await Connection.connect({ address: TEST_STACK_ENV.TEMPORAL_ADDRESS });
    scheduleClient = new ScheduleClient({
      connection,
      namespace: TEST_STACK_ENV.TEMPORAL_NAMESPACE,
    });
  }, 180_000);

  afterAll(async () => {
    await connection?.close().catch(() => undefined);
    await harness?.stop().catch(() => undefined);
  });

  it('lists bundled templates with their placeholder metadata', async () => {
    const templates = await harness.http.get<TemplateSummary[]>('/templates');
    const byId = new Map(templates.map((t) => [t.id, t]));

    // All four v1 templates present.
    for (const id of ['analyze', 'pr-review', 'develop', 'board-loop']) {
      expect(byId.has(id), `${id} template missing`).toBe(true);
    }

    // board-loop is a multi-workflow bundle.
    expect(byId.get('board-loop')?.workflowCount).toBe(2);
    // analyze is single-workflow.
    expect(byId.get('analyze')?.workflowCount).toBe(1);

    // Every template exposes the <github> placeholder — this is the
    // contract the UI's connection-binding step reads.
    for (const t of templates) {
      expect(t.placeholders).toContain('github');
    }
  });

  it('creates the board-loop bundle atomically with one shared binding', async () => {
    // A credential the user will bind once for the whole bundle. Secret
    // content doesn't matter — we never actually run these workflows.
    const cred = await harness.http.post<{ id: string }>('/credentials', {
      platform: 'GITHUB',
      name: 'e2e-phase6-pat',
      secret: 'ghp_phase6_stub',
    });

    const result = await harness.http.post<CreatedTemplateResult>(
      '/workflows/from-template/board-loop',
      {
        bindings: {
          github: {
            mode: 'new',
            alias: 'github-main',
            credentialId: cred.id,
            owner: 'acme',
            repo: 'shop',
          },
        },
      },
    );

    // Atomic creation → both workflows come back in one response.
    expect(result.workflows).toHaveLength(2);
    const names = result.workflows.map((w) => w.name).sort();
    expect(names).toEqual(['Critic', 'Worker']);

    // Each workflow row now exists and has the placeholder substituted in
    // every connection slot with a real connection cuid (not `<github>`).
    for (const { id } of result.workflows) {
      const wf = await harness.http.get<WorkflowRow>(`/workflows/${id}`);
      const def = wf.definition;

      expect(def.trigger.connectionId).toMatch(/^[a-z0-9]+$/);
      expect(def.trigger.connectionId).not.toMatch(/^</);

      for (const server of def.mcpServers) {
        expect(server.connectionId).not.toMatch(/^</);
      }
      const workerNode = def.nodes.find((n) => n.workspace.kind === 'ticket-branch');
      expect(workerNode).toBeDefined();
      if (workerNode && workerNode.workspace.kind === 'ticket-branch') {
        expect(workerNode.workspace.connectionId).not.toMatch(/^</);
      }

      // A real WorkflowConnection row was created for this workflow.
      const conns = await harness.http.get<{ id: string; alias: string }[]>(
        `/workflows/${id}/connections`,
      );
      expect(conns.map((c) => c.alias)).toContain('github-main');
      // The connection id on the trigger must be one of the workflow's connections.
      expect(conns.map((c) => c.id)).toContain(def.trigger.connectionId);
    }

    // Polling schedules are registered — both templates trigger on polling,
    // and the API upserts them after the create transaction commits.
    for (const { id } of result.workflows) {
      const handle = scheduleClient.getHandle(pollScheduleId(id));
      await waitFor(
        () => handle.describe().then(() => true).catch(() => false),
        15_000,
      );
    }
  }, 60_000);

  it('rejects creation when a required placeholder is missing', async () => {
    const res = await fetch(`${harness.apiUrl}/api/workflows/from-template/analyze`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': harness.apiKey,
      },
      body: JSON.stringify({ bindings: {} }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string; missing: string[] };
    expect(body.missing).toEqual(['github']);
  });

  it('creates a single-workflow template with no extra churn', async () => {
    const cred = await harness.http.post<{ id: string }>('/credentials', {
      platform: 'GITHUB',
      name: 'e2e-phase6-analyze-pat',
      secret: 'ghp_phase6_analyze_stub',
    });

    const result = await harness.http.post<CreatedTemplateResult>(
      '/workflows/from-template/analyze',
      {
        bindings: {
          github: {
            mode: 'new',
            alias: 'github',
            credentialId: cred.id,
          },
        },
      },
    );
    expect(result.workflows).toHaveLength(1);
    const wf = await harness.http.get<WorkflowRow>(`/workflows/${result.workflows[0]!.id}`);
    expect(wf.definition.trigger.mode.kind).toBe('webhook');
    // Webhook triggers don't get a schedule — verify we didn't accidentally
    // create one.
    const handle = scheduleClient.getHandle(pollScheduleId(wf.id));
    await expect(handle.describe()).rejects.toBeDefined();
  }, 45_000);
});
