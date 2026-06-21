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

const { findUnique, findMany, update, writeSystemLog } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  writeSystemLog: vi.fn(),
}));

vi.mock('../runtime/prisma', () => ({
  prisma: () => ({
    workflowRun: { findUnique, update },
    nodeRun: { findMany },
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
});
