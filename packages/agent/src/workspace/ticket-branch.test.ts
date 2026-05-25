import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git } from './git';
import { deriveSlug, formatBranchName } from './slug';
import { resolveTicketBranchWorkspace } from './ticket-branch';
import type { ConnectionContext, TicketBranchRow, TicketBranchStore } from './types';

/**
 * Integration test for ticket-branch resolution against a real local git
 * repo. No network, no Prisma — just the workspace manager's happy paths:
 *
 *   - first resolve: creates branch via `worktree add -b`, row comes back
 *     with the derived slug.
 *   - second resolve: remote branch now exists, `worktree add <branch>`
 *     tracks it, iteration's worktree sees prior commits.
 *   - baseRef override on first create sticks on the row.
 */

const ORG_A = 'org_a';
const ORG_B = 'org_b';

describe('resolveTicketBranchWorkspace', () => {
  let conduitHome: string;
  let originalHome: string | undefined;
  let remote: string;
  let connection: ConnectionContext;

  beforeEach(async () => {
    originalHome = process.env.CONDUIT_HOME;
    conduitHome = await fs.mkdtemp(path.join(os.tmpdir(), 'conduit-ticket-branch-'));
    process.env.CONDUIT_HOME = conduitHome;

    // Local "remote" — seeded with a main branch + one commit.
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

  it('creates the branch on first resolve and reuses it on re-run', async () => {
    const store = makeFakeStore();

    const first = await resolveTicketBranchWorkspace({
      runId: 'run_1',
      nodeName: 'Worker',
      orgId: ORG_A,
      connection,
      ticket: { id: '42', title: 'Fix crash in checkout!' },
      store,
    });

    expect(first.kind).toBe('ticket-branch');
    expect(first.branchName).toBe('conduit/42-fix-crash-in-checkout');
    expect(first.remoteBranchExisted).toBe(false);

    // Agent writes a commit on the branch + pushes to the local "remote".
    await fs.writeFile(path.join(first.path, 'fix.ts'), 'export const x = 1;\n');
    await git(['config', 'user.email', 'agent@conduit.test'], { cwd: first.path });
    await git(['config', 'user.name', 'Agent'], { cwd: first.path });
    await git(['add', '-A'], { cwd: first.path });
    await git(['commit', '-q', '-m', 'agent: first iteration'], { cwd: first.path });
    await git(['push', 'origin', first.branchName!], { cwd: first.path });

    // Second resolve (iteration N+1) — branch now exists on the "remote".
    const second = await resolveTicketBranchWorkspace({
      runId: 'run_2',
      nodeName: 'Worker',
      orgId: ORG_A,
      connection,
      ticket: { id: '42', title: 'Fix crash in checkout!' },
      store,
    });
    expect(second.branchName).toBe('conduit/42-fix-crash-in-checkout');
    expect(second.remoteBranchExisted).toBe(true);
    // Iteration N+1 sees iteration N's commit.
    const fixFile = await fs.readFile(path.join(second.path, 'fix.ts'), 'utf8');
    expect(fixFile).toBe('export const x = 1;\n');
  });

  it('keeps the slug stable when the ticket title changes later', async () => {
    const store = makeFakeStore();

    const first = await resolveTicketBranchWorkspace({
      runId: 'run_1',
      nodeName: 'Worker',
      orgId: ORG_A,
      connection,
      ticket: { id: '7', title: 'Initial title' },
      store,
    });

    const second = await resolveTicketBranchWorkspace({
      runId: 'run_2',
      nodeName: 'Worker',
      orgId: ORG_A,
      connection,
      ticket: { id: '7', title: 'Completely different title now' },
      store,
    });

    expect(second.branchName).toBe(first.branchName);
    expect(second.branchName).toBe(formatBranchName('7', 'initial-title'));
  });

  it('lands on pr.headRef without creating a row when called with PR context', async () => {
    // Simulate the upstream Worker's PR branch already on the remote.
    await git(['checkout', '-q', '-b', 'conduit/55-add-feature'], { cwd: remote });
    await fs.writeFile(path.join(remote, 'feature.ts'), 'export const feature = 1;\n');
    await git(['add', '-A'], { cwd: remote });
    await git(['commit', '-q', '-m', 'feature'], { cwd: remote });
    await git(['checkout', '-q', 'main'], { cwd: remote });

    const store = makeFakeStore();

    const resolved = await resolveTicketBranchWorkspace({
      runId: 'run_pr',
      nodeName: 'Reviewer',
      orgId: ORG_A,
      connection,
      // Issue context still passed through (GitHub conflates issues/PRs by
      // number) — the resolver must prefer pr.headRef and skip the row.
      ticket: { id: '55', title: 'PR-opened title that should be ignored' },
      store,
      pr: { headRef: 'conduit/55-add-feature', baseRef: 'main' },
    });

    expect(resolved.kind).toBe('ticket-branch');
    expect(resolved.branchName).toBe('conduit/55-add-feature');
    expect(resolved.remoteBranchExisted).toBe(true);
    expect(resolved.ticketBranchId).toBeUndefined();
    expect(store._rows()).toHaveLength(0);

    const onDisk = await fs.readFile(path.join(resolved.path, 'feature.ts'), 'utf8');
    expect(onDisk).toBe('export const feature = 1;\n');
  });

  it('two orgs targeting the same repo + ticket get distinct rows (no cross-org collision)', async () => {
    const store = makeFakeStore();

    const orgA = await resolveTicketBranchWorkspace({
      runId: 'run_org_a',
      nodeName: 'Worker',
      orgId: ORG_A,
      connection,
      ticket: { id: '99', title: 'Shared ticket id' },
      store,
    });

    const orgB = await resolveTicketBranchWorkspace({
      runId: 'run_org_b',
      nodeName: 'Worker',
      orgId: ORG_B,
      connection,
      ticket: { id: '99', title: 'Shared ticket id' },
      store,
    });

    expect(store._rows()).toHaveLength(2);
    // The branch name derives from ticketId + slug, so within the same repo
    // the two orgs end up with the *same* branch name on disk — but they
    // were upserted into independent rows, which is what isolation means
    // for this layer. Cross-org workspace collisions on the same git remote
    // are out of scope (they're a Github-side concern).
    expect(orgA.branchName).toBe(orgB.branchName);
  });

  it('Worker + Critic in the same org converge on one row (within-org sharing preserved)', async () => {
    const store = makeFakeStore();

    const worker = await resolveTicketBranchWorkspace({
      runId: 'run_worker',
      nodeName: 'Worker',
      orgId: ORG_A,
      connection,
      ticket: { id: '101', title: 'Same ticket, two workflows' },
      store,
    });
    const critic = await resolveTicketBranchWorkspace({
      runId: 'run_critic',
      nodeName: 'Critic',
      orgId: ORG_A,
      connection,
      ticket: { id: '101', title: 'Same ticket, two workflows' },
      store,
    });

    expect(store._rows()).toHaveLength(1);
    expect(worker.branchName).toBe(critic.branchName);
    expect(worker.ticketBranchId).toBe(critic.ticketBranchId);
  });

  it('lands on pr.headRef with no store/ticket needed (external PR)', async () => {
    await git(['checkout', '-q', '-b', 'patch-1'], { cwd: remote });
    await fs.writeFile(path.join(remote, 'patch.ts'), 'export const x = 2;\n');
    await git(['add', '-A'], { cwd: remote });
    await git(['commit', '-q', '-m', 'patch'], { cwd: remote });
    await git(['checkout', '-q', 'main'], { cwd: remote });

    const resolved = await resolveTicketBranchWorkspace({
      runId: 'run_ext_pr',
      nodeName: 'Reviewer',
      // No orgId / store / ticket — PR-anchored runs skip the row entirely.
      connection,
      pr: { headRef: 'patch-1', baseRef: 'main' },
    });

    expect(resolved.branchName).toBe('patch-1');
    expect(resolved.ticketBranchId).toBeUndefined();
    const onDisk = await fs.readFile(path.join(resolved.path, 'patch.ts'), 'utf8');
    expect(onDisk).toBe('export const x = 2;\n');
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
