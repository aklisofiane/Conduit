import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git } from './git';
import { WorkspaceManager } from './manager';
import { deriveSlug, formatBranchName } from './slug';
import type {
  ConnectionContext,
  TicketBranchRow,
  TicketBranchStore,
} from './types';

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
});

function makeFakeStore(): TicketBranchStore {
  const rows = new Map<string, TicketBranchRow>();
  const key = (p: string, o: string, r: string, t: string) => `${p}:${o}/${r}:${t}`;
  return {
    async upsert(input) {
      const k = key(input.platform, input.owner, input.repo, input.ticketId);
      const existing = rows.get(k);
      if (existing) return existing;
      const slug = deriveSlug(input.ticketTitle);
      const row: TicketBranchRow = {
        id: `tb_${rows.size + 1}`,
        platform: input.platform,
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
    async markRunStart() {
      /* no-op */
    },
  };
}
