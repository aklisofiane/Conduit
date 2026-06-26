import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from '@conduit/shared';
import { loadEventFixture, loadWorkflowFixture } from '../helpers/temporal';
import { deliverGithubWebhook, pollForStatus } from '../helpers/webhook';
import { startHarness, type Harness } from './harness';

/**
 * E2E coverage for on-disk workspace reclamation — the reliability gap the
 * other phase tests don't touch. Every existing e2e asserts DB status / WS
 * frames, but nothing verifies the run's local worktree is actually removed.
 *
 * `cleanupRunActivity` (apps/worker/src/activities/cleanup-run.ts) runs in the
 * agent workflow's `finally` block for *both* terminal arms (COMPLETED and
 * FAILED — only a CANCELLED workflow skips it, which is why cancellation is
 * excluded here, see failure-and-cancel-run.test.ts). It calls
 * `WorkspaceManager.cleanupRun(runId)`, which unregisters every per-run
 * worktree from its bare clone and then `fs.rm`'s the entire run dir
 * (`<CONDUIT_HOME>/runs/<runId>`). A regression that no-ops this leaks a
 * worktree per run and silently fills the host disk.
 *
 * The run dir is reconstructable from `CONDUIT_HOME` + `runId`, and the
 * COMPLETED arm persists the real host `workspacePath` on its node row
 * (`<runDir>/<nodeName>`), so the directory's absence is directly stat-able.
 *
 *   1. A COMPLETED no-op run: its node's recorded `workspacePath` was a real
 *      absolute path under `conduitHome`, and after cleanup it (and the whole
 *      run dir) are gone; the `WorkflowRun.finishedAt` is set.
 *   2. A FAILED run (agent shell exits non-zero): its run dir is likewise
 *      reclaimed — the failure arm cleans up through the same `finally`.
 *   3. Cleanup is local-only: the seeded bare remote still serves its base
 *      branch after both runs — remote state is never touched.
 */

interface CreateWorkflowResponse {
  id: string;
  definition: WorkflowDefinition;
}

interface RunDetail {
  id: string;
  status: string;
  error?: string | null;
  finishedAt?: string | null;
  nodes: Array<{
    nodeName: string;
    status: string;
    workspacePath: string | null;
    output: { workspaceKind?: string; branchName?: string } | null;
  }>;
}

const OWNER = 'acme';
const REPO = 'cleanup';

describe('Run lifecycle — workspace cleanup reclaims local worktrees', () => {
  let harness: Harness;
  let connectionId: string;
  let bareRemote: string;

  beforeAll(async () => {
    harness = await startHarness();
    // Trigger-connected agents derive `ticket-branch` workspaces — they need a
    // real bare remote to clone from (no network in the suite). The returned
    // path is the bare remote we assert stays intact after cleanup.
    bareRemote = await harness.seedTicketBranchRepo(OWNER, REPO);

    const cred = await harness.http.post<{ id: string }>('/credentials', {
      platform: 'GITHUB',
      name: 'cleanup-github-pat',
      secret: 'ghp_stub_token_for_tests',
    });
    const connection = await harness.http.post<{ id: string }>('/connections', {
      name: `${OWNER}/${REPO}`,
      credentialId: cred.id,
      scope: { kind: 'github_repo', owner: OWNER, repo: REPO },
    });
    connectionId = connection.id;
  });

  afterAll(async () => {
    await harness?.stop();
  });

  /**
   * Fresh workflow per test off the phase2 fixture, wired to the shared
   * connection + webhook secret and activated. A fresh workflow per test keeps
   * run dedup (keyed per workflow+ticket) from soft-dropping a delivery.
   */
  async function createWiredWorkflow(secret: string): Promise<string> {
    const fixture = await loadWorkflowFixture('phase2-webhook-issue');
    const created = await harness.http.post<CreateWorkflowResponse>('/workflows', {
      name: fixture.name,
      description: fixture.description,
      definition: fixture.definition,
    });
    const patched: WorkflowDefinition = {
      ...created.definition,
      triggers: created.definition.triggers.map((t) => ({ ...t, connectionId })),
    };
    await harness.http.put(`/workflows/${created.id}`, { definition: patched, isActive: true });
    await harness.http.put(`/workflows/${created.id}/webhook-secret`, { secret });
    return created.id;
  }

  /** A clone of the issues.opened payload with a distinct issue number. */
  async function issuePayload(issueNumber: number): Promise<unknown> {
    const base = (await loadEventFixture('github', 'issues.opened')) as {
      issue: { number: number };
    };
    return { ...base, issue: { ...base.issue, number: issueNumber } };
  }

  /** `git show <ref>` against the bare remote; resolves with stdout or rejects. */
  function gitShow(repo: string, ref: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', ['show', ref], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout?.on('data', (c: Buffer) => out.push(c));
      child.stderr?.on('data', (c: Buffer) => err.push(c));
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) return resolve(Buffer.concat(out).toString());
        reject(new Error(`git show ${ref} exited ${code}: ${Buffer.concat(err).toString()}`));
      });
    });
  }

  it('removes a COMPLETED run’s worktree and marks the run finished', async () => {
    const secret = 'cleanup-completed-secret';
    const workflowId = await createWiredWorkflow(secret);

    // A no-op agent: it resolves a real ticket-branch worktree, does nothing,
    // and completes. Cleanup must still reclaim the worktree.
    await harness.setStubScript({ steps: [{ kind: 'done' }] });

    const { runId } = await deliverGithubWebhook(harness, workflowId, {
      event: 'issues',
      deliveryId: 'cleanup-completed-1',
      secret,
      payload: await issuePayload(201),
    });

    // Status only flips to COMPLETED *inside* cleanupRunActivity (it writes the
    // terminal status + finishedAt after `cleanupRun`), so observing COMPLETED
    // guarantees the on-disk cleanup already ran.
    const finalRun = await pollForStatus(
      () => harness.http.get<RunDetail>(`/runs/${runId}`),
      (r) => r.status === 'COMPLETED' || r.status === 'FAILED' || r.status === 'CANCELLED',
      60_000,
    );
    expect(finalRun.status).toBe('COMPLETED');
    // cleanupRunActivity stamps finishedAt alongside the terminal status.
    expect(finalRun.finishedAt).toBeTruthy();

    const triage = finalRun.nodes.find((n) => n.nodeName === 'Triage');
    expect(triage).toBeDefined();
    const wsPath = triage!.workspacePath;

    // Before cleanup this was a real, non-empty, absolute path under
    // conduitHome — the node row preserves the string even though the dir is
    // gone. (The run dir is `<conduitHome>/runs/<runId>`; the worktree is a
    // child of it.)
    expect(typeof wsPath).toBe('string');
    expect(wsPath!.length).toBeGreaterThan(0);
    expect(path.isAbsolute(wsPath!)).toBe(true);
    expect(wsPath!.startsWith(harness.conduitHome)).toBe(true);

    // The worktree tmpdir was actually removed from disk.
    await expect(fs.stat(wsPath!)).rejects.toThrow();

    // …and so was the whole run dir — no leftover sibling worktrees linger
    // under conduitHome for this runId.
    const runWorkspaceRoot = path.join(harness.conduitHome, 'runs', runId);
    await expect(fs.stat(runWorkspaceRoot)).rejects.toThrow();

    // Local-only cleanup: the bare remote still serves its seeded base branch.
    const readme = await gitShow(bareRemote, 'main:README.md');
    expect(readme).toContain('Seed repo');
  });

  it('removes a FAILED run’s worktree too (failure arm cleans up)', async () => {
    const secret = 'cleanup-failed-secret';
    const workflowId = await createWiredWorkflow(secret);

    // The agent "starts working" then hits a command that exits non-zero —
    // `runShell` throws, failing the node and routing the workflow's finally
    // block through cleanupRunActivity with status FAILED.
    await harness.setStubScript({
      steps: [
        { kind: 'text', delta: 'Investigating…' },
        { kind: 'shell', command: 'sh', args: ['-c', 'exit 7'] },
      ],
    });

    const { runId } = await deliverGithubWebhook(harness, workflowId, {
      event: 'issues',
      deliveryId: 'cleanup-failed-1',
      secret,
      payload: await issuePayload(202),
    });

    const finalRun = await pollForStatus(
      () => harness.http.get<RunDetail>(`/runs/${runId}`),
      (r) => r.status === 'COMPLETED' || r.status === 'FAILED' || r.status === 'CANCELLED',
      60_000,
    );
    expect(finalRun.status).toBe('FAILED');
    expect(finalRun.error).toBeTruthy();
    expect(finalRun.finishedAt).toBeTruthy();

    // The failure arm doesn't persist the node's `workspacePath` column (the
    // catch in run-agent-node only writes status/error/finishedAt), so assert
    // reclamation via the deterministic run dir instead: cleanupRun wipes the
    // entire `<conduitHome>/runs/<runId>` tree regardless of node outcome.
    const runWorkspaceRoot = path.join(harness.conduitHome, 'runs', runId);
    await expect(fs.stat(runWorkspaceRoot)).rejects.toThrow();

    // Remote state survives the failed run's cleanup unchanged.
    const readme = await gitShow(bareRemote, 'main:README.md');
    expect(readme).toContain('Seed repo');
  });
});
