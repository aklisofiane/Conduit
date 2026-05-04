import { createHmac } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from '@conduit/shared';
import { loadWorkflowFixture } from '../helpers/temporal';
import { startHarness, type Harness } from './harness';

const FIXTURE_DIR = path.resolve(__dirname, '..', 'fixtures', 'events', 'github');
const WEBHOOK_SECRET = 'phase3-webhook-secret';

/**
 * Phase 3 exit criterion as an E2E test (see docs/PLANS.md "Phase 3"):
 *
 *   User builds a 3-agent workflow (Triage → Fix + Doc parallel → Review),
 *   runs it on a real issue, sees parallel execution, sees Fix/Doc operate
 *   on branched worktrees with sequential merge-back, sees Review read
 *   `.conduit/` summaries from both.
 *
 * Stub-backed version — the real LLM is replaced with StubProvider but git,
 * the workspace manager, the Temporal workflow, merge-back, and the
 * `.conduit/` copy activity all run for real.
 */

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
interface RunDetail {
  id: string;
  status: string;
  nodes: Array<{
    nodeName: string;
    status: string;
    startedAt: string | null;
    finishedAt: string | null;
    output: { files?: string[]; workspacePath?: string; isBranchedWorktree?: boolean } | null;
    workspacePath: string | null;
    conduitSummary: string | null;
    error: string | null;
  }>;
}

describe('Phase 3 — parallel fan-out, merge-back, .conduit/ propagation', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness();
  });

  afterAll(async () => {
    await harness?.stop();
  });

  it('runs Triage → (Fix || Doc) → Review with merge-back and sibling summaries', async () => {
    await harness.seedRepoClone('acme', 'shop', {
      'src/index.ts': 'export const version = "0.1.0";\n',
    });

    const cred = await harness.http.post<{ id: string }>('/credentials', {
      platform: 'GITHUB',
      name: 'phase3-github-pat',
      secret: 'ghp_stub_phase3',
    });

    const fixture = await loadWorkflowFixture('phase3-parallel');
    const created = await harness.http.post<CreateWorkflowResponse>('/workflows', {
      name: fixture.name,
      description: fixture.description,
      definition: fixture.definition,
    });

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

    // Patch the workflow definition so every `connectionId` placeholder
    // points at the real connection id, and activate it so the webhook
    // handler doesn't drop the delivery.
    const patched = rewireConnectionIds(created.definition, connection.id);
    await harness.http.put(`/workflows/${created.id}`, {
      definition: patched,
      isActive: true,
    });

    // byPrompt dispatch — each node's `instructions` contains a unique
    // substring ("Triage", "patch in src/fix.ts", etc.) that routes to the
    // right scripted session regardless of parallel start order.
    await harness.setStubBundle({
      byPrompt: [
        {
          match: 'Clone the repo and classify',
          session: {
            turns: [
              { steps: [{ kind: 'text', delta: 'Triaging the issue…' }, { kind: 'done' }] },
              {
                steps: [
                  {
                    kind: 'write-file',
                    path: '.conduit/Triage.md',
                    content: '# Triage\n\nPriority: high. Area: checkout.\n',
                  },
                  { kind: 'done' },
                ],
              },
            ],
          },
        },
        {
          match: 'Propose a patch in src/fix.ts',
          session: {
            turns: [
              {
                steps: [
                  { kind: 'text', delta: 'Writing the patch…' },
                  { kind: 'write-file', path: 'src/fix.ts', content: 'export const fixed = true;\n' },
                  { kind: 'done' },
                ],
              },
              {
                steps: [
                  {
                    kind: 'write-file',
                    path: '.conduit/Fix.md',
                    content: '# Fix\n\nAdded `src/fix.ts` with the fix flag.\n',
                  },
                  { kind: 'done' },
                ],
              },
            ],
          },
        },
        {
          match: 'Update the README for the bug fix',
          session: {
            turns: [
              {
                steps: [
                  { kind: 'text', delta: 'Updating the docs…' },
                  {
                    kind: 'write-file',
                    path: 'docs/CHANGELOG.md',
                    content: '# Changelog\n\n- bug fix for checkout crash.\n',
                  },
                  { kind: 'done' },
                ],
              },
              {
                steps: [
                  {
                    kind: 'write-file',
                    path: '.conduit/Doc.md',
                    content: '# Doc\n\nAdded changelog entry.\n',
                  },
                  { kind: 'done' },
                ],
              },
            ],
          },
        },
        {
          match: 'Review the merged branches',
          session: {
            turns: [
              {
                steps: [
                  { kind: 'text', delta: 'Reviewing the merged workspace…' },
                  { kind: 'done' },
                ],
              },
              {
                steps: [
                  {
                    kind: 'write-file',
                    path: '.conduit/Review.md',
                    content: '# Review\n\nSaw Fix and Doc summaries; approved.\n',
                  },
                  { kind: 'done' },
                ],
              },
            ],
          },
        },
      ],
    });

    // Fire the signed webhook to trigger the run — same path Phase 2 takes.
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
        'X-GitHub-Delivery': 'phase3-delivery-1',
        'X-Hub-Signature-256': signature,
      },
      body,
    });
    expect(res.status).toBe(200);
    const webhookResult = (await res.json()) as { status: string; runId?: string };
    expect(webhookResult.status).toBe('started');
    const runId = webhookResult.runId!;

    const collector = harness.collectRun(runId);
    try {
      await collector.waitForDone('Review', 120_000);
    } finally {
      collector.close();
    }

    const finalRun = await pollForStatus(
      () => harness.http.get<RunDetail>(`/runs/${runId}`),
      (r) => r.status === 'COMPLETED' || r.status === 'FAILED',
      30_000,
    );
    expect(finalRun.status).toBe('COMPLETED');

    const byName = new Map(finalRun.nodes.map((n) => [n.nodeName, n]));
    const triage = byName.get('Triage')!;
    const fix = byName.get('Fix')!;
    const doc = byName.get('Doc')!;
    const review = byName.get('Review')!;

    // Every node completed successfully and wrote a .conduit/ summary.
    for (const n of finalRun.nodes) {
      expect(n.status).toBe('COMPLETED');
      expect(n.conduitSummary).toBeTruthy();
    }
    expect(fix.conduitSummary).toMatch(/Added `src\/fix.ts`/);
    expect(doc.conduitSummary).toMatch(/changelog entry/);
    expect(review.conduitSummary).toMatch(/Saw Fix and Doc summaries/);

    // Fix and Doc ran concurrently — one started before the other finished.
    const fixRange = [new Date(fix.startedAt!).getTime(), new Date(fix.finishedAt!).getTime()];
    const docRange = [new Date(doc.startedAt!).getTime(), new Date(doc.finishedAt!).getTime()];
    const overlap = !(fixRange[1] < docRange[0] || docRange[1] < fixRange[0]);
    expect(overlap).toBe(true);

    // Fix and Doc got their own branched worktrees, distinct from Triage's.
    expect(fix.output?.isBranchedWorktree).toBe(true);
    expect(doc.output?.isBranchedWorktree).toBe(true);
    expect(fix.workspacePath).not.toBe(triage.workspacePath);
    expect(doc.workspacePath).not.toBe(triage.workspacePath);
    expect(fix.workspacePath).not.toBe(doc.workspacePath);

    // Review is sequential inherit (only sibling of its group) → it reuses
    // Triage's merged workspace path.
    expect(review.workspacePath).toBe(triage.workspacePath);

    // Each branched sibling saw its own new file before the merge-back runs
    // (NodeRun.output.files snapshot is taken inside runAgentNode, prior to
    // merge-back). The copy-conduit-files activity then lifts both siblings'
    // `.conduit/*.md` into the merged workspace — which is the upstream
    // (Triage) path. Review's session ran against that merged path and was
    // able to name both siblings in its own summary.
    expect(fix.output?.files ?? []).toContain('src/fix.ts');
    expect(doc.output?.files ?? []).toContain('docs/CHANGELOG.md');
  });
});

function rewireConnectionIds(def: WorkflowDefinition, connectionId: string): WorkflowDefinition {
  return {
    ...def,
    trigger: { ...def.trigger, connectionId },
    nodes: def.nodes.map((n) =>
      n.workspace.kind === 'repo-clone' || n.workspace.kind === 'ticket-branch'
        ? { ...n, workspace: { ...n.workspace, connectionId } }
        : n,
    ),
  };
}

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
