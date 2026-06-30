import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupRunActivity } from './cleanup-run';

/**
 * Part B — cleanup resilience. When a concurrent run has evicted a node's
 * worktree, `countCommitsAhead` spawns git in a vanished cwd and gets a
 * `spawn git ENOENT` (not a GitError). That must not escape: the run still
 * has to reach its terminal-status write or it hangs in RUNNING forever.
 *
 * Real `@conduit/agent` git is used so the ENOENT path is genuinely
 * exercised; only prisma + the log writer are mocked.
 */

const { findUnique, findMany, aggregate, update, writeSystemLog } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  aggregate: vi.fn(),
  update: vi.fn(),
  writeSystemLog: vi.fn(),
}));

vi.mock('../runtime/prisma', () => ({
  prisma: () => ({
    workflowRun: { findUnique, update },
    nodeRun: { findMany, aggregate },
  }),
}));

vi.mock('../runtime/log-writer', () => ({ writeSystemLog }));

describe('cleanupRunActivity', () => {
  let conduitHome: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.CONDUIT_HOME;
    conduitHome = await fs.mkdtemp(path.join(os.tmpdir(), 'conduit-cleanup-run-'));
    process.env.CONDUIT_HOME = conduitHome;
    findUnique.mockResolvedValue({ orgId: 'org_1' });
    aggregate.mockResolvedValue({ _sum: { costUsd: null } });
    update.mockResolvedValue({});
    writeSystemLog.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    process.env.CONDUIT_HOME = originalHome;
    await fs.rm(conduitHome, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('marks the run terminal even when a ticket-branch worktree has vanished', async () => {
    // workspacePath points at a directory that no longer exists — exactly the
    // post-eviction state. countCommitsAhead's git spawn fails with ENOENT.
    findMany.mockResolvedValue([
      {
        nodeName: 'Worker',
        workspacePath: path.join(conduitHome, 'runs', 'gone', 'Worker'),
        output: {
          workspaceKind: 'ticket-branch',
          branchName: 'conduit/1-x',
          head: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        },
      },
    ]);

    await expect(
      cleanupRunActivity({ runId: 'run_1', status: 'FAILED', error: 'boom' }),
    ).resolves.toBeUndefined();

    // Terminal write happened with the right status — the run is no longer
    // stuck in RUNNING.
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run_1' },
        data: expect.objectContaining({ status: 'FAILED', error: 'boom' }),
      }),
    );

    // The ENOENT was swallowed inside countCommitsAhead, so the outer
    // best-effort wrapper never had to log a check failure.
    const warned = writeSystemLog.mock.calls.some((c) =>
      String(c[3]).includes('unpushed-commit check failed'),
    );
    expect(warned).toBe(false);
  });

  it('rolls the run total tokens (from usage) and cost into the WorkflowRun', async () => {
    // Two completed agent nodes with usage; cost is summed in SQL (mocked).
    findMany.mockResolvedValue([
      { usage: { inputTokens: 100, outputTokens: 40 } },
      { usage: { inputTokens: 25, outputTokens: 10 } },
    ]);
    aggregate.mockResolvedValue({ _sum: { costUsd: 0.00513 } });

    await cleanupRunActivity({ runId: 'run_2', status: 'COMPLETED' });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run_2' },
        data: expect.objectContaining({
          status: 'COMPLETED',
          totalInputTokens: 125,
          totalOutputTokens: 50,
          totalCostUsd: 0.00513,
        }),
      }),
    );
  });

  it('leaves the run totals null when no node recorded usage', async () => {
    findMany.mockResolvedValue([{ usage: null }]);
    aggregate.mockResolvedValue({ _sum: { costUsd: null } });

    await cleanupRunActivity({ runId: 'run_3', status: 'COMPLETED' });

    const data = update.mock.calls.at(-1)?.[0]?.data ?? {};
    expect(data.totalInputTokens).toBeUndefined();
    expect(data.totalOutputTokens).toBeUndefined();
    expect(data.totalCostUsd).toBeUndefined();
  });
});
