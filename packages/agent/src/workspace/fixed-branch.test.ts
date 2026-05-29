import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveFixedBranchWorkspace } from './fixed-branch';
import { git } from './git';
import { resolveTicketBranchWorkspace } from './ticket-branch';
import { deriveSlug, formatBranchName } from './slug';
import type { ConnectionContext, TicketBranchRow, TicketBranchStore } from './types';

/**
 * Integration tests for fixed-branch resolution against a real local git
 * repo — and the cross-workspace fetch conflict that motivated fetching into
 * `refs/remotes/origin/*` instead of mirroring into `refs/heads/*`.
 *
 * The base clone is shared per repo and hosts every run's worktree. A
 * fixed-branch run (e.g. a nightly review on `main`) leaves a worktree with
 * `main` checked out; a later run mirroring `refs/heads/*` would hit
 * "refusing to fetch into branch 'refs/heads/main' checked out at …" and
 * abort. These tests pin that this no longer happens.
 */

const ORG_A = 'org_a';

describe('resolveFixedBranchWorkspace', () => {
  let conduitHome: string;
  let originalHome: string | undefined;
  let remote: string;
  let connection: ConnectionContext;

  beforeEach(async () => {
    originalHome = process.env.CONDUIT_HOME;
    conduitHome = await fs.mkdtemp(path.join(os.tmpdir(), 'conduit-fixed-branch-'));
    process.env.CONDUIT_HOME = conduitHome;

    remote = path.join(conduitHome, 'remote');
    await fs.mkdir(remote, { recursive: true });
    await git(['init', '-q', '-b', 'main'], { cwd: remote });
    await git(['config', 'user.email', 'seed@conduit.test'], { cwd: remote });
    await git(['config', 'user.name', 'Seed'], { cwd: remote });
    await fs.writeFile(path.join(remote, 'README.md'), '# Seed\n');
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
    process.env.CONDUIT_HOME = originalHome;
    await fs.rm(conduitHome, { recursive: true, force: true });
  });

  it('lands on the requested branch and sees the latest remote tip', async () => {
    // Advance main on the remote after the base clone would first see it.
    const first = await resolveFixedBranchWorkspace({
      runId: 'run_1',
      nodeName: 'Scope',
      connection,
      branch: 'main',
    });
    expect(first.kind).toBe('fixed-branch');
    expect(first.branchName).toBe('main');
    expect(first.remoteBranchExisted).toBe(true);

    // Remote moves; a fresh run must pick up the new commit.
    await fs.writeFile(path.join(remote, 'next.txt'), 'next\n');
    await git(['add', '-A'], { cwd: remote });
    await git(['commit', '-q', '-m', 'second'], { cwd: remote });

    const second = await resolveFixedBranchWorkspace({
      runId: 'run_2',
      nodeName: 'Scope',
      connection,
      branch: 'main',
    });
    const onDisk = await fs.readFile(path.join(second.path, 'next.txt'), 'utf8');
    expect(onDisk).toBe('next\n');
  });

  it('a worktree sitting on main does not break a later ticket-branch fetch', async () => {
    // Regression: a fixed-branch run (nightly review) holds `main` checked
    // out in a live worktree. A subsequent Develop run resolving a ticket
    // branch must still fetch cleanly — previously the mirror into
    // refs/heads/* refused to update refs/heads/main.
    const review = await resolveFixedBranchWorkspace({
      runId: 'review_run',
      nodeName: 'Scope',
      connection,
      branch: 'main',
    });
    expect(review.branchName).toBe('main');

    // The review worktree is still on disk / registered — do NOT remove it.
    const store = makeFakeStore();
    const develop = await resolveTicketBranchWorkspace({
      runId: 'develop_run',
      nodeName: 'Worker',
      orgId: ORG_A,
      connection,
      ticket: { id: '7', title: 'Fix the thing' },
      store,
    });

    expect(develop.kind).toBe('ticket-branch');
    expect(develop.branchName).toBe('conduit/7-fix-the-thing');
    // And the review worktree is untouched.
    const reviewReadme = await fs.readFile(path.join(review.path, 'README.md'), 'utf8');
    expect(reviewReadme).toBe('# Seed\n');
  });
});

function makeFakeStore(): TicketBranchStore & { _rows(): TicketBranchRow[] } {
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
    async markRunStart() {
      /* no-op */
    },
    _rows: () => [...rows.values()],
  };
}
