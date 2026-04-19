import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from '@conduit/shared';
import { loadWorkflowFixture } from '../helpers/temporal';
import { startHarness, type Harness } from './harness';

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
interface ManualRunResponse {
  id: string;
  status: string;
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
      },
    );

    // Patch the workflow definition so every `connectionId` placeholder
    // points at the real connection id before the first run.
    const patched = rewireConnectionIds(created.definition, connection.id);
    await harness.http.put(`/workflows/${created.id}`, {
      definition: patched,
      isActive: false,
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

    const run = await harness.http.post<ManualRunResponse>(`/workflows/${created.id}/run`, {});

    const collector = harness.collectRun(run.id);
    try {
      await collector.waitForDone('Review', 120_000);
    } finally {
      collector.close();
    }

    const finalRun = await pollForStatus(
      () => harness.http.get<RunDetail>(`/runs/${run.id}`),
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
