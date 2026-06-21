import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BranchBusyError } from '../errors/index';
import { git } from './git';
import { dropConflictingWorktrees } from './worktree-cleanup';
import { touchWorktreeHeartbeat } from './worktree-heartbeat';

/**
 * Liveness-aware eviction against real git worktrees. The branch-match arm is
 * gated on `<worktree>/.conduit/.heartbeat`:
 *   - fresh heartbeat ⇒ live owner ⇒ BranchBusyError, nothing removed.
 *   - stale/absent     ⇒ crashed run ⇒ force-removed as before.
 *   - path-match       ⇒ this run's own stale target ⇒ removed regardless.
 */
describe('dropConflictingWorktrees', () => {
  let conduitHome: string;
  let originalHome: string | undefined;
  let base: string;

  beforeEach(async () => {
    originalHome = process.env.CONDUIT_HOME;
    conduitHome = await fs.mkdtemp(path.join(os.tmpdir(), 'conduit-wt-cleanup-'));
    process.env.CONDUIT_HOME = conduitHome;

    base = path.join(conduitHome, 'base');
    await fs.mkdir(base, { recursive: true });
    await git(['init', '-q', '-b', 'main'], { cwd: base });
    await git(['config', 'user.email', 'seed@conduit.test'], { cwd: base });
    await git(['config', 'user.name', 'Seed'], { cwd: base });
    await fs.writeFile(path.join(base, 'README.md'), '# seed\n');
    await git(['add', '-A'], { cwd: base });
    await git(['commit', '-q', '-m', 'seed'], { cwd: base });
  });

  afterEach(async () => {
    process.env.CONDUIT_HOME = originalHome;
    await fs.rm(conduitHome, { recursive: true, force: true });
  });

  /** Add a worktree under `<CONDUIT_HOME>/runs/...` so the fs.rm gate fires. */
  async function addWorktree(name: string, branch: string): Promise<string> {
    const p = path.join(conduitHome, 'runs', 'run_owner', name);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await git(['worktree', 'add', '-q', '-b', branch, p, 'main'], { cwd: base });
    return p;
  }

  async function isRegistered(p: string): Promise<boolean> {
    const list = await git(['worktree', 'list', '--porcelain'], { cwd: base });
    return list.includes(`worktree ${p}\n`);
  }

  it('throws BranchBusyError and keeps a live branch-match worktree', async () => {
    const owner = await addWorktree('owner', 'feature');
    await touchWorktreeHeartbeat(owner);

    const target = path.join(conduitHome, 'runs', 'run_taker', 'taker');
    await expect(dropConflictingWorktrees(base, target, 'feature')).rejects.toBeInstanceOf(
      BranchBusyError,
    );

    // Owner is untouched: still registered, still on disk.
    expect(await isRegistered(owner)).toBe(true);
    await expect(fs.access(owner)).resolves.toBeUndefined();
  });

  it('force-removes a branch-match worktree with no heartbeat', async () => {
    const owner = await addWorktree('owner', 'feature');
    // No heartbeat written → reads as a dead owner.

    const target = path.join(conduitHome, 'runs', 'run_taker', 'taker');
    await dropConflictingWorktrees(base, target, 'feature');

    expect(await isRegistered(owner)).toBe(false);
    await expect(fs.access(owner)).rejects.toThrow();
  });

  it('force-removes a branch-match worktree whose heartbeat is stale', async () => {
    const owner = await addWorktree('owner', 'feature');
    await touchWorktreeHeartbeat(owner);
    // Back-date the heartbeat well past WORKTREE_STALE_MS (120s).
    const old = new Date(Date.now() - 10 * 60_000);
    await fs.utimes(path.join(owner, '.conduit', '.heartbeat'), old, old);

    const target = path.join(conduitHome, 'runs', 'run_taker', 'taker');
    await dropConflictingWorktrees(base, target, 'feature');

    expect(await isRegistered(owner)).toBe(false);
    await expect(fs.access(owner)).rejects.toThrow();
  });

  it('removes a path-match worktree even with a fresh heartbeat', async () => {
    const target = await addWorktree('target', 'feature');
    await touchWorktreeHeartbeat(target);

    // Path-only call (no branchName) — the run's own stale target is always
    // safe to remove, liveness notwithstanding.
    await dropConflictingWorktrees(base, target);

    expect(await isRegistered(target)).toBe(false);
    await expect(fs.access(target)).rejects.toThrow();
  });
});
