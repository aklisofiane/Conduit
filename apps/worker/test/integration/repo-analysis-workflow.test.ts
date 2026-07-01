import path from 'node:path';
import { type WorkflowBundle, Worker, bundleWorkflowCode } from '@temporalio/worker';
import type { TestWorkflowEnvironment } from '@temporalio/testing';
import {
  buildAnalysisTriggerEvent,
  type AssemblyPresets,
  type ComponentManifest,
  type NodeOutput,
  type RepoAnalysisWorkflowInput,
  type WorkflowDraft,
} from '@conduit/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestWorkflowEnv } from '../../../../test/helpers/temporal';
import { repoAnalysisWorkflow } from '../../src/workflows/repo-analysis-workflow';

/**
 * Temporal-level integration for `repoAnalysisWorkflow`. Workflow code runs in
 * the real bundled V8 sandbox under a time-skipping server; every activity is
 * mocked so we assert on orchestration — phase progression, the Discover
 * retry loop, Design fan-out with `allSettled`-style dropping, and the
 * `finally` cleanup contract.
 */

interface ActivityCall {
  name: string;
  input: unknown;
}

interface MockBehavior {
  manifest: ComponentManifest;
  /** Discover's manifest read throws this many times before succeeding. */
  manifestFailures?: number;
  /** Design indices whose draft read always throws (component dropped). */
  failDesignIndices?: Set<number>;
}

const PRESETS: AssemblyPresets = {
  scope: { provider: 'claude', model: 'claude-sonnet-5', instructions: 's' },
  codeAnalyst: { provider: 'codex', model: 'gpt-5.5', instructions: 'c' },
  issuePublisher: { provider: 'claude', model: 'claude-sonnet-5', instructions: 'p' },
};

function manifest(componentNames: string[]): ComponentManifest {
  return {
    components: componentNames.map((name) => ({
      name,
      paths: [`apps/${name}/**`],
      rationale: 'r',
      criticality: 'medium' as const,
    })),
  };
}

function designIndexOf(workspacePath: string): number | null {
  const m = workspacePath.match(/Design_(\d+)$/);
  return m ? Number(m[1]) : null;
}

describe('repoAnalysisWorkflow orchestration (TestWorkflowEnvironment)', () => {
  let env: TestWorkflowEnvironment;
  let bundle: WorkflowBundle;
  let taskQueueSeq = 0;
  let calls: ActivityCall[];
  let behavior: MockBehavior;

  beforeAll(async () => {
    env = await createTestWorkflowEnv();
    bundle = await bundleWorkflowCode({
      workflowsPath: path.resolve(__dirname, '../../src/workflows/index.ts'),
    });
  }, 120_000);

  afterAll(async () => {
    await env?.teardown();
  });

  beforeEach(() => {
    calls = [];
  });

  function makeActivities() {
    let manifestAttempts = 0;
    return {
      async cloneAnalysisWorkspaceActivity(input: unknown) {
        calls.push({ name: 'cloneAnalysisWorkspaceActivity', input });
        return { repo: { owner: 'acme', name: 'api' }, platform: 'github', defaultBranch: 'main' };
      },
      async runAgentNode(input: { node: { name: string } }): Promise<NodeOutput> {
        calls.push({ name: 'runAgentNode', input });
        return {
          workspacePath: `/ws/${input.node.name}`,
          head: `head-${input.node.name}`,
          isBranchedWorktree: false,
        };
      },
      async readComponentManifestActivity(input: { workspacePath: string }): Promise<ComponentManifest> {
        calls.push({ name: 'readComponentManifestActivity', input });
        manifestAttempts += 1;
        if (behavior.manifestFailures && manifestAttempts <= behavior.manifestFailures) {
          throw new Error(`bad manifest #${manifestAttempts}`);
        }
        return behavior.manifest;
      },
      async readWorkflowDraftActivity(input: { workspacePath: string }): Promise<WorkflowDraft> {
        calls.push({ name: 'readWorkflowDraftActivity', input });
        const idx = designIndexOf(input.workspacePath);
        if (idx !== null && behavior.failDesignIndices?.has(idx)) {
          throw new Error(`bad draft for Design_${idx}`);
        }
        const component = behavior.manifest.components[idx ?? 0]!;
        return {
          component: component.name,
          workflowName: `Review: ${component.name}`,
          summary: 'what',
          rationale: 'why',
          scopeInstructions: `Scope review of ${component.name}: route security-relevant changes to Security and quality issues to Quality.`,
          reviewers: [
            { name: 'Security', instructions: 'Review for auth bypasses and input-validation gaps.' },
            { name: 'Quality', instructions: 'Review for logic errors and missing error handling.' },
          ],
          cron: '0 2 * * *',
          paths: component.paths,
        };
      },
      async updateAnalysisPhaseActivity(input: unknown): Promise<void> {
        calls.push({ name: 'updateAnalysisPhaseActivity', input });
      },
      async assembleSuggestionsActivity(input: unknown): Promise<void> {
        calls.push({ name: 'assembleSuggestionsActivity', input });
      },
      async cleanupRunActivity(input: unknown): Promise<void> {
        calls.push({ name: 'cleanupRunActivity', input });
      },
    };
  }

  async function runWorkflow(b: MockBehavior): Promise<void> {
    behavior = b;
    const taskQueue = `analysis-wf-int-${taskQueueSeq++}`;
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowBundle: bundle,
      activities: makeActivities(),
    });
    const input: RepoAnalysisWorkflowInput = {
      analysisId: 'an_int',
      internalRunId: 'run_int',
      systemWorkflowId: 'sys_int',
      orgId: 'org_int',
      connectionId: 'conn_int',
      triggerEvent: buildAnalysisTriggerEvent({ platform: 'github', repo: { owner: 'acme', name: 'api' } }),
      presets: PRESETS,
    };
    await worker.runUntil(
      env.client.workflow.execute(repoAnalysisWorkflow, {
        args: [input],
        workflowId: `analysis-exec-${taskQueue}`,
        taskQueue,
      }),
    );
  }

  const callsNamed = (name: string): ActivityCall[] => calls.filter((c) => c.name === name);
  const phases = (): unknown[] =>
    callsNamed('updateAnalysisPhaseActivity').map((c) => c.input);
  const assembleInput = (): Record<string, unknown> | undefined =>
    callsNamed('assembleSuggestionsActivity')[0]?.input as Record<string, unknown> | undefined;

  it('runs Discover → Design×N → Assemble and cleans up COMPLETED', async () => {
    await runWorkflow({ manifest: manifest(['API', 'Web']) });

    // One Discover run + one Design run per component. Discover is strictly
    // first; the per-component Design nodes fan out in parallel, so their
    // recorded execution order isn't guaranteed — compare them as a set.
    const runNodes = callsNamed('runAgentNode').map(
      (c) => (c.input as { node: { name: string } }).node.name,
    );
    expect(runNodes[0]).toBe('Discover');
    expect(runNodes.slice(1).sort()).toEqual(['Design_0', 'Design_1']);

    // Phase progression: ANALYZING/DISCOVER → DESIGN → ASSEMBLE.
    expect(phases()).toEqual([
      { analysisId: 'an_int', status: 'ANALYZING', phase: 'DISCOVER' },
      { analysisId: 'an_int', phase: 'DESIGN' },
      { analysisId: 'an_int', phase: 'ASSEMBLE' },
    ]);

    // Assemble gets both drafts, no drops.
    const ai = assembleInput()!;
    expect((ai.drafts as unknown[]).length).toBe(2);
    expect((ai.dropped as unknown[]).length).toBe(0);

    const cleanup = callsNamed('cleanupRunActivity')[0]!.input as { status: string };
    expect(cleanup.status).toBe('COMPLETED');
  });

  it('retries Discover when the manifest is unparseable, then proceeds', async () => {
    await runWorkflow({ manifest: manifest(['API']), manifestFailures: 1 });

    // Discover agent re-run after the first bad manifest.
    const discoverRuns = callsNamed('runAgentNode').filter(
      (c) => (c.input as { node: { name: string } }).node.name === 'Discover',
    );
    expect(discoverRuns).toHaveLength(2);
    expect(callsNamed('assembleSuggestionsActivity')).toHaveLength(1);
    const cleanup = callsNamed('cleanupRunActivity')[0]!.input as { status: string };
    expect(cleanup.status).toBe('COMPLETED');
  });

  it('drops a component whose Design fails after retries, keeping the rest', async () => {
    await runWorkflow({ manifest: manifest(['API', 'Web', 'Worker']), failDesignIndices: new Set([1]) });

    const ai = assembleInput()!;
    expect((ai.drafts as { component: string }[]).map((d) => d.component)).toEqual(['API', 'Worker']);
    const dropped = ai.dropped as { component: string }[];
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.component).toBe('Web');

    // Still a clean run — a single component failing doesn't sink the analysis.
    const cleanup = callsNamed('cleanupRunActivity')[0]!.input as { status: string };
    expect(cleanup.status).toBe('COMPLETED');
  });

  it('retries Discover when manifest exceeds the component cap', async () => {
    // First readComponentManifestActivity call simulates a cap-exceeded rejection
    // (manifestFailures: 1 causes the mock to throw on the first attempt).
    await runWorkflow({ manifest: manifest(['API']), manifestFailures: 1 });

    const discoverRuns = callsNamed('runAgentNode').filter(
      (c) => (c.input as { node: { name: string } }).node.name === 'Discover',
    );
    expect(discoverRuns).toHaveLength(2);
    expect(callsNamed('assembleSuggestionsActivity')).toHaveLength(1);
    const cleanup = callsNamed('cleanupRunActivity')[0]!.input as { status: string };
    expect(cleanup.status).toBe('COMPLETED');
  });

  it('fails the analysis (FAILED phase + cleanup) when Discover never parses', async () => {
    await runWorkflow({ manifest: manifest(['API']), manifestFailures: 3 });

    // Discover retried up to the cap (3 agent runs), then gave up.
    const discoverRuns = callsNamed('runAgentNode').filter(
      (c) => (c.input as { node: { name: string } }).node.name === 'Discover',
    );
    expect(discoverRuns).toHaveLength(3);
    expect(callsNamed('assembleSuggestionsActivity')).toHaveLength(0);

    const failPhase = phases().find(
      (p) => (p as { status?: string }).status === 'FAILED',
    );
    expect(failPhase).toMatchObject({ status: 'FAILED' });
    const cleanup = callsNamed('cleanupRunActivity')[0]!.input as { status: string };
    expect(cleanup.status).toBe('FAILED');
  });
});
