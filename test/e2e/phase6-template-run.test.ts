import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Connection, ScheduleClient } from '@temporalio/client';
import { workflowScheduleId, type WorkflowDefinition } from '@conduit/shared';
import { startHarness, type Harness } from './harness';
import { TEST_STACK_ENV } from './stack';

/**
 * Phase 6 exit criterion: user picks a template, binds their connection(s),
 * workflows are created atomically and ready to run.
 *
 * Verifies:
 *
 *   1. `GET /api/templates` lists the v1 templates with placeholder metadata.
 *   2. `POST /api/workflows/from-template/:id` for the `board-loop` bundle
 *      creates *both* workflows in a single call with the
 *      `<github-repo>` / `<github-board>` placeholders resolved to real
 *      Connection ids on each.
 *   3. The resolved definitions reference real Connection cuids in every
 *      connection slot (trigger, mcpServers, boardConnectionId).
 *   4. Polling schedules are upserted for polling-mode templates (here
 *      both Developer and Reviewer are polling).
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

    for (const id of ['analyze', 'pr-review', 'develop', 'board-loop']) {
      expect(byId.has(id), `${id} template missing`).toBe(true);
    }

    expect(byId.get('board-loop')?.workflowCount).toBe(2);
    expect(byId.get('analyze')?.workflowCount).toBe(1);

    // Every template exposes the <github-repo> placeholder — board-loop +
    // develop additionally surface <github-board>.
    for (const t of templates) {
      expect(t.placeholders).toContain('github-repo');
    }
    expect(byId.get('board-loop')?.placeholders).toContain('github-board');
  });

  it('creates the board-loop bundle atomically with one shared pair of bindings', async () => {
    const cred = await harness.http.post<{ id: string }>('/credentials', {
      platform: 'GITHUB',
      name: 'e2e-phase6-pat',
      secret: 'ghp_phase6_stub',
    });

    const result = await harness.http.post<CreatedTemplateResult>(
      '/workflows/from-template/board-loop',
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

    expect(result.workflows).toHaveLength(2);
    const names = result.workflows.map((w) => w.name).sort();
    expect(names).toEqual(['Developer', 'Reviewer']);

    // Both workflows in the bundle reference the same pair of connection ids.
    let sharedRepoId: string | undefined;
    let sharedBoardId: string | undefined;
    for (const { id } of result.workflows) {
      const wf = await harness.http.get<WorkflowRow>(`/workflows/${id}`);
      const def = wf.definition;

      const trigger = def.triggers[0]!;
      expect(trigger.connectionId).toMatch(/^[a-z0-9]+$/);
      expect(trigger.connectionId).not.toMatch(/^</);
      expect(trigger.boardConnectionId).toMatch(/^[a-z0-9]+$/);
      expect(trigger.boardConnectionId).not.toMatch(/^</);

      sharedRepoId ??= trigger.connectionId;
      sharedBoardId ??= trigger.boardConnectionId;
      expect(trigger.connectionId).toBe(sharedRepoId);
      expect(trigger.boardConnectionId).toBe(sharedBoardId);

      for (const server of def.mcpServers) {
        expect(server.connectionId).not.toMatch(/^</);
      }
      for (const node of def.nodes) {
        expect(node.workspace).toBeUndefined();
      }
    }

    for (const { id } of result.workflows) {
      const handle = scheduleClient.getHandle(workflowScheduleId(id));
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
        cookie: harness.authCookie,
      },
      body: JSON.stringify({ bindings: {} }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string; missing: string[] };
    expect(body.missing).toEqual(['github-repo']);
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
          'github-repo': {
            mode: 'new',
            name: 'acme/shop',
            credentialId: cred.id,
            scope: { kind: 'github_repo', owner: 'acme', repo: 'shop' },
          },
        },
      },
    );
    expect(result.workflows).toHaveLength(1);
    const wf = await harness.http.get<WorkflowRow>(`/workflows/${result.workflows[0]!.id}`);
    expect(wf.definition.triggers[0]!.type).toBe('webhook');
    const handle = scheduleClient.getHandle(workflowScheduleId(wf.id));
    await expect(handle.describe()).rejects.toBeDefined();
  }, 45_000);
});
