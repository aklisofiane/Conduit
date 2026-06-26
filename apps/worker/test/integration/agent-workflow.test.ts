import path from 'node:path';
import { type WorkflowBundle, Worker, bundleWorkflowCode } from '@temporalio/worker';
import type { TestWorkflowEnvironment } from '@temporalio/testing';
import type { AgentConfigWithWorkspace, NodeOutput, TriggerEvent } from '@conduit/shared';
import { MergeConflictError } from '@conduit/agent';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestWorkflowEnv } from '../../../../test/helpers/temporal';
import type { LoadedGraph } from '../../src/activities/load-graph';
import { agentWorkflow, type AgentWorkflowInput } from '../../src/workflows/agent-workflow';

/**
 * Temporal-level integration for `agentWorkflow`. The workflow code runs in
 * the real (bundled) V8 sandbox under a time-skipping test server; every
 * activity is mocked so we assert on *orchestration* — topo-sort order,
 * parallel fan-out, merge-back sequencing, retry behavior, and the
 * `finally`-block cleanup contract — without touching Postgres/git/providers.
 *
 * This is the layer `VALIDATION.md` calls out for "assert on activity call
 * order, retry behavior, signal/cancellation handling" — it had no coverage
 * before. The activity bodies themselves are unit-tested next to their source.
 */

/** Minimal call record so tests can assert order across all activities. */
interface ActivityCall {
  name: string;
  input: unknown;
}

/** Behavior knobs a test can set before executing the workflow. */
interface MockBehavior {
  graph: LoadedGraph;
  /** Node names whose `runAgentNode` should throw (fail the run). */
  failNodes?: Set<string>;
  /** If set, `loadGraphActivity` throws this many times before succeeding. */
  loadGraphFailures?: number;
  /** When true, `mergeWorktreeActivity` throws a (non-retryable) MergeConflictError. */
  mergeConflict?: boolean;
}

const TRIGGER_EVENT: TriggerEvent = {
  source: 'webhook',
  platform: 'github',
  kind: 'issue',
  action: 'opened',
  raw: {},
} as unknown as TriggerEvent;

/**
 * Build a `LoadedGraph` the way `loadGraphActivity` would, but by hand. The
 * workflow only reads `node.name`, `node.workspace.{kind,fromNode}`,
 * `trigger.name`, and the edges — so the casts below are safe and keep the
 * fixture tiny.
 */
function makeGraph(spec: {
  triggerName: string;
  nodes: Array<{ name: string; kind: string; fromNode?: string }>;
  edges: Array<{ from: string; to: string }>;
}): LoadedGraph {
  return {
    workflowId: 'wf_int',
    workflowName: 'Integration WF',
    orgId: 'org_int',
    triggers: [{ name: spec.triggerName }] as unknown as LoadedGraph['triggers'],
    nodes: spec.nodes.map(
      (n) =>
        ({
          name: n.name,
          workspace:
            n.kind === 'inherit' ? { kind: 'inherit', fromNode: n.fromNode } : { kind: n.kind },
        }) as unknown as AgentConfigWithWorkspace,
    ),
    edges: spec.edges,
    mcpServers: [],
  };
}

describe('agentWorkflow orchestration (TestWorkflowEnvironment)', () => {
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

  /** Activity mocks that record every call and honor the test's behavior knobs. */
  function makeActivities() {
    let loadGraphAttempts = 0;
    return {
      async loadGraphActivity(workflowId: string): Promise<LoadedGraph> {
        calls.push({ name: 'loadGraphActivity', input: workflowId });
        loadGraphAttempts += 1;
        if (behavior.loadGraphFailures && loadGraphAttempts <= behavior.loadGraphFailures) {
          throw new Error(`transient load failure #${loadGraphAttempts}`);
        }
        return behavior.graph;
      },
      async runAgentNode(input: {
        node: { name: string };
        parallelBranch?: boolean;
      }): Promise<NodeOutput> {
        calls.push({ name: 'runAgentNode', input });
        if (behavior.failNodes?.has(input.node.name)) {
          throw new Error(`node ${input.node.name} blew up`);
        }
        return {
          workspacePath: `/ws/${input.node.name}`,
          head: `head-${input.node.name}`,
          isBranchedWorktree: input.parallelBranch ?? false,
        };
      },
      async mergeWorktreeActivity(input: unknown): Promise<void> {
        calls.push({ name: 'mergeWorktreeActivity', input });
        if (behavior.mergeConflict) {
          throw new MergeConflictError('/ws/target', 'abc123', ['shared.txt']);
        }
      },
      async copyConduitFilesActivity(input: unknown): Promise<void> {
        calls.push({ name: 'copyConduitFilesActivity', input });
      },
      async cleanupRunActivity(input: unknown): Promise<void> {
        calls.push({ name: 'cleanupRunActivity', input });
      },
    };
  }

  /** Run `agentWorkflow` to completion against a fresh worker on its own queue. */
  async function runWorkflow(b: MockBehavior): Promise<void> {
    behavior = b;
    const taskQueue = `agent-wf-int-${taskQueueSeq++}`;
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowBundle: bundle,
      activities: makeActivities(),
    });
    const input: AgentWorkflowInput = {
      workflowId: 'wf_int',
      runId: 'run_int',
      triggerEvent: TRIGGER_EVENT,
    };
    await worker.runUntil(
      env.client.workflow.execute(agentWorkflow, {
        args: [input],
        workflowId: `wf-exec-${taskQueue}`,
        taskQueue,
      }),
    );
  }

  const names = (): string[] => calls.map((c) => c.name);
  const runNodeNames = (): string[] =>
    calls
      .filter((c) => c.name === 'runAgentNode')
      .map((c) => (c.input as { node: { name: string } }).node.name);

  it('runs nodes in topo order and cleans up COMPLETED on success', async () => {
    await runWorkflow({
      graph: makeGraph({
        triggerName: 'Webhook',
        nodes: [
          { name: 'A', kind: 'repo-clone' },
          { name: 'B', kind: 'inherit', fromNode: 'A' },
        ],
        edges: [
          { from: 'Webhook', to: 'A' },
          { from: 'A', to: 'B' },
        ],
      }),
    });

    expect(runNodeNames()).toEqual(['A', 'B']);
    const cleanup = calls.find((c) => c.name === 'cleanupRunActivity');
    expect(cleanup?.input).toMatchObject({ runId: 'run_int', status: 'COMPLETED' });
    expect((cleanup?.input as { error?: string }).error).toBeUndefined();
  });

  it('fans out parallel inherit siblings and merges them back in definition order', async () => {
    await runWorkflow({
      graph: makeGraph({
        triggerName: 'Webhook',
        nodes: [
          { name: 'Triage', kind: 'ticket-branch' },
          { name: 'Fix', kind: 'inherit', fromNode: 'Triage' },
          { name: 'Doc', kind: 'inherit', fromNode: 'Triage' },
        ],
        edges: [
          { from: 'Webhook', to: 'Triage' },
          { from: 'Triage', to: 'Fix' },
          { from: 'Triage', to: 'Doc' },
        ],
      }),
    });

    // Both siblings are told they're parallel-branched.
    const siblingCalls = calls.filter(
      (c) =>
        c.name === 'runAgentNode' &&
        ['Fix', 'Doc'].includes((c.input as { node: { name: string } }).node.name),
    );
    expect(siblingCalls).toHaveLength(2);
    for (const c of siblingCalls) {
      expect((c.input as { parallelBranch: boolean }).parallelBranch).toBe(true);
    }

    // Merge-back runs once per sibling, in definition order (Fix before Doc).
    const merges = calls
      .filter((c) => c.name === 'mergeWorktreeActivity')
      .map((c) => (c.input as { sourceNodeName: string }).sourceNodeName);
    expect(merges).toEqual(['Fix', 'Doc']);

    // One copy pass carrying both siblings' .conduit summaries.
    const copies = calls.filter((c) => c.name === 'copyConduitFilesActivity');
    expect(copies).toHaveLength(1);
    expect((copies[0]!.input as { sources: unknown[] }).sources).toHaveLength(2);

    expect(calls.at(-1)).toMatchObject({ name: 'cleanupRunActivity' });
    expect((calls.at(-1)?.input as { status: string }).status).toBe('COMPLETED');
  });

  it('marks the run FAILED (and rethrows) when a node activity throws', async () => {
    await expect(
      runWorkflow({
        graph: makeGraph({
          triggerName: 'Webhook',
          nodes: [{ name: 'A', kind: 'repo-clone' }],
          edges: [{ from: 'Webhook', to: 'A' }],
        }),
        failNodes: new Set(['A']),
      }),
    ).rejects.toThrow();

    const cleanup = calls.find((c) => c.name === 'cleanupRunActivity');
    expect(cleanup?.input).toMatchObject({ runId: 'run_int', status: 'FAILED' });
    // The run is marked failed with a non-empty error. Note: Temporal wraps the
    // activity's throw in an ActivityFailure, so `errorMessage` surfaces the
    // generic "Activity task failed" — the underlying cause lives in `err.cause`.
    const failError = (cleanup?.input as { error?: string }).error;
    expect(failError).toBeTruthy();
    expect(typeof failError).toBe('string');
    // No merge/copy happened — the failure short-circuited the group.
    expect(names()).not.toContain('mergeWorktreeActivity');
  });

  it('retries a transient loadGraph failure and still completes (time-skipping)', async () => {
    await runWorkflow({
      graph: makeGraph({
        triggerName: 'Webhook',
        nodes: [{ name: 'A', kind: 'repo-clone' }],
        edges: [{ from: 'Webhook', to: 'A' }],
      }),
      loadGraphFailures: 1,
    });

    // First attempt threw, second succeeded — the 2s backoff was skipped.
    expect(calls.filter((c) => c.name === 'loadGraphActivity')).toHaveLength(2);
    const cleanup = calls.find((c) => c.name === 'cleanupRunActivity');
    expect((cleanup?.input as { status: string }).status).toBe('COMPLETED');
  });

  /** The `runAgentNode` input recorded for a given node, or undefined. */
  const runInputFor = (node: string): Record<string, unknown> | undefined =>
    calls.find(
      (c) =>
        c.name === 'runAgentNode' && (c.input as { node: { name: string } }).node.name === node,
    )?.input as Record<string, unknown> | undefined;

  it('threads each node’s workspace path/head into its inherit downstream', async () => {
    await runWorkflow({
      graph: makeGraph({
        triggerName: 'Webhook',
        nodes: [
          { name: 'A', kind: 'repo-clone' },
          { name: 'B', kind: 'inherit', fromNode: 'A' },
          { name: 'C', kind: 'inherit', fromNode: 'B' },
        ],
        edges: [
          { from: 'Webhook', to: 'A' },
          { from: 'A', to: 'B' },
          { from: 'B', to: 'C' },
        ],
      }),
    });

    expect(runNodeNames()).toEqual(['A', 'B', 'C']);
    // A is an entry node — no upstream handoff.
    expect(runInputFor('A')?.upstreamWorkspacePath).toBeUndefined();
    // B inherits A; C inherits B. Each sees its predecessor's output.
    expect(runInputFor('B')?.upstreamWorkspacePath).toBe('/ws/A');
    expect(runInputFor('B')?.upstreamHead).toBe('head-A');
    expect(runInputFor('C')?.upstreamWorkspacePath).toBe('/ws/B');
    expect(runInputFor('C')?.upstreamHead).toBe('head-B');
  });

  it('passes graph-relationship metadata (directUpstream / parallelDownstream)', async () => {
    await runWorkflow({
      graph: makeGraph({
        triggerName: 'Webhook',
        nodes: [
          { name: 'Triage', kind: 'ticket-branch' },
          { name: 'Fix', kind: 'inherit', fromNode: 'Triage' },
          { name: 'Doc', kind: 'inherit', fromNode: 'Triage' },
        ],
        edges: [
          { from: 'Webhook', to: 'Triage' },
          { from: 'Triage', to: 'Fix' },
          { from: 'Triage', to: 'Doc' },
        ],
      }),
    });

    // Triage fans out to two parallel downstream nodes.
    expect(runInputFor('Triage')?.parallelDownstream).toEqual(['Fix', 'Doc']);
    // Each sibling's single direct upstream is Triage.
    expect(runInputFor('Fix')?.directUpstream).toEqual(['Triage']);
    expect(runInputFor('Doc')?.directUpstream).toEqual(['Triage']);
  });

  it('does not merge-back independent (non-inherit) nodes in the same group', async () => {
    await runWorkflow({
      graph: makeGraph({
        triggerName: 'Webhook',
        nodes: [
          { name: 'X', kind: 'repo-clone' },
          { name: 'Y', kind: 'repo-clone' },
        ],
        edges: [
          { from: 'Webhook', to: 'X' },
          { from: 'Webhook', to: 'Y' },
        ],
      }),
    });

    // Both run (same entry group) but neither inherits, so there is no
    // branched-worktree fan-out — no merge-back, no .conduit copy.
    expect(runNodeNames().sort()).toEqual(['X', 'Y']);
    expect(names()).not.toContain('mergeWorktreeActivity');
    expect(names()).not.toContain('copyConduitFilesActivity');
    expect((calls.at(-1)?.input as { status: string }).status).toBe('COMPLETED');
  });

  it('treats a merge-back conflict as non-retryable and fails the run', async () => {
    await expect(
      runWorkflow({
        graph: makeGraph({
          triggerName: 'Webhook',
          nodes: [
            { name: 'Triage', kind: 'ticket-branch' },
            { name: 'Fix', kind: 'inherit', fromNode: 'Triage' },
            { name: 'Doc', kind: 'inherit', fromNode: 'Triage' },
          ],
          edges: [
            { from: 'Webhook', to: 'Triage' },
            { from: 'Triage', to: 'Fix' },
            { from: 'Triage', to: 'Doc' },
          ],
        }),
        mergeConflict: true,
      }),
    ).rejects.toThrow();

    // MergeConflictError is in the activity's nonRetryableErrorTypes, so the
    // merge is attempted exactly once (not retried 3×) before the run fails.
    expect(calls.filter((c) => c.name === 'mergeWorktreeActivity')).toHaveLength(1);
    const cleanup = calls.find((c) => c.name === 'cleanupRunActivity');
    expect((cleanup?.input as { status: string }).status).toBe('FAILED');
  });

  it('completes a single-node graph', async () => {
    await runWorkflow({
      graph: makeGraph({
        triggerName: 'Webhook',
        nodes: [{ name: 'Solo', kind: 'fresh-tmpdir' }],
        edges: [{ from: 'Webhook', to: 'Solo' }],
      }),
    });

    expect(runNodeNames()).toEqual(['Solo']);
    expect(names()).not.toContain('mergeWorktreeActivity');
    expect((calls.at(-1)?.input as { status: string }).status).toBe('COMPLETED');
  });
});
