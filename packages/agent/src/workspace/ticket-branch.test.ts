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
      spec: { kind: 'ticket-branch', connectionId: 'conn_test' },
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
      spec: { kind: 'ticket-branch', connectionId: 'conn_test' },
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
      spec: { kind: 'ticket-branch', connectionId: 'conn_test' },
      connection,
      ticket: { id: '7', title: 'Initial title' },
      store,
    });

    const second = await resolveTicketBranchWorkspace({
      runId: 'run_2',
      nodeName: 'Worker',
      spec: { kind: 'ticket-branch', connectionId: 'conn_test' },
      connection,
      ticket: { id: '7', title: 'Completely different title now' },
      store,
    });

    expect(second.branchName).toBe(first.branchName);
    expect(second.branchName).toBe(formatBranchName('7', 'initial-title'));
  });

  it('honors the spec-level baseRef on first create only', async () => {
    // Add a second branch "dev" on the remote.
    await git(['checkout', '-q', '-b', 'dev'], { cwd: remote });
    await fs.writeFile(path.join(remote, 'dev-only.txt'), 'dev\n');
    await git(['add', '-A'], { cwd: remote });
    await git(['commit', '-q', '-m', 'dev'], { cwd: remote });
    await git(['checkout', '-q', 'main'], { cwd: remote });

    const store = makeFakeStore();

    const first = await resolveTicketBranchWorkspace({
      runId: 'run_1',
      nodeName: 'Worker',
      spec: { kind: 'ticket-branch', connectionId: 'conn_test', baseRef: 'dev' },
      connection,
      ticket: { id: '99', title: 'From dev' },
      store,
    });

    const onDisk = await fs.readFile(path.join(first.path, 'dev-only.txt'), 'utf8');
    expect(onDisk).toBe('dev\n');
    const rows = store._rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.baseRef).toBe('dev');
  });
});

function makeFakeStore(): TicketBranchStore & { _rows(): TicketBranchRow[] } {
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
    _rows: () => [...rows.values()],
  };
}
