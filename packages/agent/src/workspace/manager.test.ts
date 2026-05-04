import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git } from './git';
import { WorkspaceManager } from './manager';
import type { ConnectionContext } from './types';

/**
 * Idempotency tests for `repoClone` and `inheritBranched` under simulated
 * Temporal retries: the second `resolve()` call against the same
 * (runId, nodeName) must succeed even when the first attempt left a
 * worktree (and possibly a stranded directory) behind.
 *
 * No network, no Prisma — local bare clone seeded under `CONDUIT_HOME`.
 */
describe('WorkspaceManager retry idempotency', () => {
  let conduitHome: string;
  let originalHome: string | undefined;
  let bareRepo: string;
  let connection: ConnectionContext;

  beforeEach(async () => {
    originalHome = process.env.CONDUIT_HOME;
    conduitHome = await fs.mkdtemp(path.join(os.tmpdir(), 'conduit-manager-'));
    process.env.CONDUIT_HOME = conduitHome;

    // Seed a local repo + bare clone at the path WorkspaceManager expects
    // (`base-clones/<platform>/<owner>/<repo>.git`) so `ensureBaseClone`
    // skips the network.
    const seed = path.join(conduitHome, 'seed');
    await fs.mkdir(seed, { recursive: true });
    await git(['init', '-q', '-b', 'main'], { cwd: seed });
    await git(['config', 'user.email', 'seed@conduit.test'], { cwd: seed });
    await git(['config', 'user.name', 'Seed'], { cwd: seed });
    await fs.writeFile(path.join(seed, 'README.md'), '# seed\n');
    await git(['add', '-A'], { cwd: seed });
    await git(['commit', '-q', '-m', 'seed'], { cwd: seed });

    bareRepo = path.join(conduitHome, 'base-clones', 'github', 'acme', 'shop.git');
    await fs.mkdir(path.dirname(bareRepo), { recursive: true });
    await git(['clone', '--bare', '-q', seed, bareRepo]);
    await git(['remote', 'set-url', 'origin', seed], { cwd: bareRepo });

    connection = {
      id: 'conn_test',
      platform: 'github',
      owner: 'acme',
      repo: 'shop',
      cloneUrl: seed,
    };
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.CONDUIT_HOME;
    else process.env.CONDUIT_HOME = originalHome;
    await fs.rm(conduitHome, { recursive: true, force: true });
  });

  it('repo-clone resolve is idempotent across simulated retries', async () => {
    const manager = new WorkspaceManager();
    const runId = 'run-retry-repo-clone';
    const nodeName = 'Seed';

    const first = await manager.resolve({
      runId,
      nodeName,
      spec: { kind: 'repo-clone', connectionId: connection.id },
      connection,
    });
    expect(first.kind).toBe('repo-clone');
    await expect(fs.access(first.path)).resolves.toBeUndefined();

    // Drop a stranded file in the worktree to simulate post-add agent state
    // from the previous attempt — the retry should clobber it.
    await fs.writeFile(path.join(first.path, 'stranded.txt'), 'left over\n');

    const second = await manager.resolve({
      runId,
      nodeName,
      spec: { kind: 'repo-clone', connectionId: connection.id },
      connection,
    });

    expect(second.path).toBe(first.path);
    expect(second.head).toBe(first.head);
    await expect(fs.readFile(path.join(second.path, 'README.md'), 'utf8')).resolves.toContain(
      '# seed',
    );
    // Stranded file is gone — pre-cleanup wiped the prior worktree state.
    await expect(fs.access(path.join(second.path, 'stranded.txt'))).rejects.toThrow();
  });

  it('repo-clone recovers when only the directory survives (worktree metadata pruned)', async () => {
    const manager = new WorkspaceManager();
    const runId = 'run-retry-orphan-dir';
    const nodeName = 'Seed';

    // First call: real worktree, real git registration.
    const first = await manager.resolve({
      runId,
      nodeName,
      spec: { kind: 'repo-clone', connectionId: connection.id },
      connection,
    });

    // Simulate a partial-cleanup state: git metadata was pruned, but the
    // working dir remains. `worktree remove` will fail (no registration)
    // and `prune` is a no-op; the explicit fs.rm in the fix is what saves us.
    await git(['worktree', 'remove', '--force', first.path], { cwd: bareRepo });
    await fs.mkdir(first.path, { recursive: true });
    await fs.writeFile(path.join(first.path, 'orphan.txt'), 'orphan\n');

    const second = await manager.resolve({
      runId,
      nodeName,
      spec: { kind: 'repo-clone', connectionId: connection.id },
      connection,
    });

    expect(second.path).toBe(first.path);
    await expect(fs.readFile(path.join(second.path, 'README.md'), 'utf8')).resolves.toContain(
      '# seed',
    );
    await expect(fs.access(path.join(second.path, 'orphan.txt'))).rejects.toThrow();
  });

  it('parallel-branched inherit resolve is idempotent across simulated retries', async () => {
    const manager = new WorkspaceManager();
    const runId = 'run-retry-inherit';

    const upstream = await manager.resolve({
      runId,
      nodeName: 'Seed',
      spec: { kind: 'repo-clone', connectionId: connection.id },
      connection,
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
