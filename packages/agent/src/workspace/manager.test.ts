import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git } from './git';
import { WorkspaceManager } from './manager';
import { deriveSlug, formatBranchName } from './slug';
import type { ConnectionContext, TicketBranchRow, TicketBranchStore } from './types';

const ORG_ID = 'org_manager_test';

/**
 * Idempotency test for `inheritBranched` under simulated Temporal retries:
 * the second `resolve()` call against the same (runId, nodeName) must
 * succeed even when the first attempt left a worktree (and possibly a
 * stranded directory) behind.
 *
 * The upstream is a `ticket-branch` workspace seeded against a local bare
 * clone — no network, no Prisma — covered by an in-memory store.
 */
describe('WorkspaceManager retry idempotency', () => {
  let conduitHome: string;
  let originalHome: string | undefined;
  let connection: ConnectionContext;

  beforeEach(async () => {
    originalHome = process.env.CONDUIT_HOME;
    conduitHome = await fs.mkdtemp(path.join(os.tmpdir(), 'conduit-manager-'));
    process.env.CONDUIT_HOME = conduitHome;

    // Local "remote" — the workspace manager treats this as the upstream
    // origin via `cloneUrl` and clones into `base-clones/<...>` on demand.
    const remote = path.join(conduitHome, 'remote');
    await fs.mkdir(remote, { recursive: true });
    await git(['init', '-q', '-b', 'main'], { cwd: remote });
    await git(['config', 'user.email', 'seed@conduit.test'], { cwd: remote });
    await git(['config', 'user.name', 'Seed'], { cwd: remote });
    await fs.writeFile(path.join(remote, 'README.md'), '# seed\n');
    await git(['add', '-A'], { cwd: remote });
    await git(['commit', '-q', '-m', 'seed'], { cwd: remote });

    connection = {
      id: 'conn_test',
      platform: 'github',
      host: 'github.com',
      owner: 'acme',
      repo: 'shop',
      cloneUrl: remote,
    };
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.CONDUIT_HOME;
    else process.env.CONDUIT_HOME = originalHome;
    await fs.rm(conduitHome, { recursive: true, force: true });
  });

  it('parallel-branched inherit resolve is idempotent across simulated retries', async () => {
    const manager = new WorkspaceManager();
    const runId = 'run-retry-inherit';
    const store = makeFakeStore();

    // Upstream Seed lands on a `conduit/<id>-<slug>` ticket branch.
    const upstream = await manager.resolve({
      runId,
      nodeName: 'Seed',
      spec: { kind: 'ticket-branch' },
      orgId: ORG_ID,
      connection,
      ticket: { id: '7', title: 'Seed work' },
      ticketBranchStore: store,
    });

    const first = await manager.resolve({
      runId,
      nodeName: 'Dev',
      spec: { kind: 'inherit', fromNode: 'Seed' },
      upstreamPath: upstream.path,
      upstreamHead: upstream.head,
      parallelBranch: true,
    });
    expect(first.isBranchedWorktree).toBe(true);
    expect(first.head).toBe(upstream.head);

    await fs.writeFile(path.join(first.path, 'wip.txt'), 'mid-flight\n');

    const second = await manager.resolve({
      runId,
      nodeName: 'Dev',
      spec: { kind: 'inherit', fromNode: 'Seed' },
      upstreamPath: upstream.path,
      upstreamHead: upstream.head,
      parallelBranch: true,
    });

    expect(second.path).toBe(first.path);
    expect(second.head).toBe(first.head);
    await expect(fs.access(path.join(second.path, 'wip.txt'))).rejects.toThrow();
  });

  it('parallel-branched inherit copies the upstream .conduit/ into the sibling', async () => {
    const manager = new WorkspaceManager();
    const runId = 'run-conduit-propagate';
    const store = makeFakeStore();

    const upstream = await manager.resolve({
      runId,
      nodeName: 'Seed',
      spec: { kind: 'ticket-branch' },
      orgId: ORG_ID,
      connection,
      ticket: { id: '13', title: 'Conduit propagation' },
      ticketBranchStore: store,
    });

    await fs.mkdir(path.join(upstream.path, '.conduit'), { recursive: true });
    await fs.writeFile(path.join(upstream.path, '.conduit', 'Seed.md'), '# Seed\nhandoff body\n');

    const sibling = await manager.resolve({
      runId,
      nodeName: 'Dev',
      spec: { kind: 'inherit', fromNode: 'Seed' },
      upstreamPath: upstream.path,
      upstreamHead: upstream.head,
      parallelBranch: true,
    });

    const copied = await fs.readFile(path.join(sibling.path, '.conduit', 'Seed.md'), 'utf8');
    expect(copied).toBe('# Seed\nhandoff body\n');
  });

  it('cleanupRun unregisters worktrees from the bare clone, not just the dir', async () => {
    const manager = new WorkspaceManager();
    const runId = 'run-cleanup-worktrees';
    const store = makeFakeStore();

    const ws = await manager.resolve({
      runId,
      nodeName: 'Dev',
      spec: { kind: 'ticket-branch' },
      orgId: ORG_ID,
      connection,
      ticket: { id: '11', title: 'Cleanup probe' },
      ticketBranchStore: store,
    });

    const bare = path.join(conduitHome, 'base-clones', 'github', 'github.com', 'acme', 'shop.git');
    expect(await listBareWorktreeNames(bare)).not.toEqual([]);

    await manager.cleanupRun(runId);

    // No orphan registration left to trip up the next resolve on this branch.
    await expect(fs.access(ws.path)).rejects.toThrow();
    expect(await listBareWorktreeNames(bare)).toEqual([]);
  });

  it('createTrackingWorktree recovers from a stale orphan that pins the branch', async () => {
    const manager = new WorkspaceManager();
    const store = makeFakeStore();

    // Run A creates the ticket-branch worktree, then crashes — directory
    // and bare-clone worktree registration both leak. To make the next
    // run hit the *create* (not *track*) path, we also delete the local
    // branch ref to mimic a `fetch --prune` having eaten it (the branch
    // was never pushed to the remote).
    const runA = 'run-a-crashed';
    const wsA = await manager.resolve({
      runId: runA,
      nodeName: 'Dev',
      spec: { kind: 'ticket-branch' },
      orgId: ORG_ID,
      connection,
      ticket: { id: '42', title: 'Stale orphan' },
      ticketBranchStore: store,
    });
    const branchName = wsA.branchName!;
    const bare = path.join(conduitHome, 'base-clones', 'github', 'github.com', 'acme', 'shop.git');
    // Simulate `fetch --prune` deleting the local-only branch ref while
    // the worktree still names it. `git update-ref -d` refuses for an
    // in-use branch, so we drop the loose ref file directly — same end
    // state on disk.
    await fs.rm(path.join(bare, 'refs', 'heads', branchName), { force: true });

    // Run B tries to land on the same ticket — the branch ref is gone so
    // it falls into createTrackingWorktree, where the orphan registration
    // from run A would normally fail the `git worktree add -b ...` call.
    const runB = 'run-b-recovers';
    const wsB = await manager.resolve({
      runId: runB,
      nodeName: 'Dev',
      spec: { kind: 'ticket-branch' },
      orgId: ORG_ID,
      connection,
      ticket: { id: '42', title: 'Stale orphan' },
      ticketBranchStore: store,
    });

    expect(wsB.branchName).toBe(branchName);
    expect(wsB.path).not.toBe(wsA.path);
    expect(await listBareWorktreeNames(bare)).toContain(path.basename(wsB.path));
    // Run A's directory was reaped during recovery.
    await expect(fs.access(wsA.path)).rejects.toThrow();
  });
});

async function listBareWorktreeNames(bare: string): Promise<string[]> {
  try {
    return await fs.readdir(path.join(bare, 'worktrees'));
  } catch {
    return [];
  }
}

function makeFakeStore(): TicketBranchStore {
  const rows = new Map<string, TicketBranchRow>();
  const key = (org: string, p: string, o: string, r: string, t: string) =>
    `${org}::${p}:${o}/${r}:${t}`;
  return {
    async upsert(input) {
      const k = key(input.orgId, input.platform, input.owner, input.repo, input.ticketId);
      const existing = rows.get(k);
      if (existing) return existing;
      const slug = deriveSlug(input.ticketTitle);
      const row: TicketBranchRow = {
        id: `tb_${rows.size + 1}`,
        platform: input.platform,
        hostUrl: input.hostUrl,
        owner: input.owner,
        repo: input.repo,
        ticketId: input.ticketId,
        slug,
        branchName: formatBranchName(input.ticketId, slug),
        baseRef: input.baseRef,
      };
      rows.set(k, row);
      return row;
    },
    async find(q) {
      return rows.get(key(q.orgId, q.platform, q.owner, q.repo, q.ticketId)) ?? null;
    },
    async markRunStart() {
      /* no-op */
    },
  };
}
