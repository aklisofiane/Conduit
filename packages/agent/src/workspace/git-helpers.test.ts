import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git } from './git';
import {
  addTrackingWorktree,
  cloneFetchAuthArgs,
  createTrackingWorktree,
  defaultBranch,
  ensureBaseClone,
  fetchWithAuth,
  remoteBranchExists,
  stripRemoteAuth,
} from './git-helpers';
import type { ConnectionContext } from './types';

/**
 * Unit tests for the extracted git-helpers. Uses real local git repos (no
 * mocking) — mirrors the approach in ticket-branch.test.ts / fixed-branch.test.ts.
 */

describe('git-helpers', () => {
  let conduitHome: string;
  let originalHome: string | undefined;
  let remote: string;
  let connection: ConnectionContext;

  beforeEach(async () => {
    originalHome = process.env.CONDUIT_HOME;
    conduitHome = await fs.mkdtemp(path.join(os.tmpdir(), 'conduit-git-helpers-'));
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

  describe('ensureBaseClone', () => {
    it('creates a bare clone when no HEAD file exists', async () => {
      const bare = path.join(conduitHome, 'base-clones', 'test.git');
      await ensureBaseClone(bare, connection);

      const headExists = await fs.access(path.join(bare, 'HEAD')).then(
        () => true,
        () => false,
      );
      expect(headExists).toBe(true);

      const isBare = (await git(['config', '--get', 'core.bare'], { cwd: bare })).trim();
      expect(isBare).toBe('true');
    });

    it('is idempotent — skips clone when HEAD already exists', async () => {
      const bare = path.join(conduitHome, 'base-clones', 'test.git');
      await ensureBaseClone(bare, connection);

      const headBefore = await fs.stat(path.join(bare, 'HEAD'));
      await ensureBaseClone(bare, connection);
      const headAfter = await fs.stat(path.join(bare, 'HEAD'));

      expect(headAfter.mtimeMs).toBe(headBefore.mtimeMs);
    });

    it('sets the remote URL back to the clean cloneUrl after cloning', async () => {
      const bare = path.join(conduitHome, 'base-clones', 'test.git');
      const connWithToken: ConnectionContext = {
        ...connection,
        cloneUrl: `file://${remote}`,
        token: 'ghs_secret123',
      };
      await ensureBaseClone(bare, connWithToken);

      const remoteUrl = (await git(['remote', 'get-url', 'origin'], { cwd: bare })).trim();
      expect(remoteUrl).toBe(`file://${remote}`);
      expect(remoteUrl).not.toContain('ghs_secret123');
    });
  });

  describe('cloneFetchAuthArgs', () => {
    it('keeps the token out of the git argv — env only', () => {
      const { flags, env } = cloneFetchAuthArgs({ ...connection, token: 'ghs_secret123' });
      expect(flags.join(' ')).not.toContain('ghs_secret123');
      expect(env?.CONDUIT_GIT_TOKEN).toBe('ghs_secret123');
      expect(env?.GIT_TERMINAL_PROMPT).toBe('0');
    });

    it('clears inherited helpers before installing its own', () => {
      const { flags } = cloneFetchAuthArgs({ ...connection, token: 't' });
      expect(flags[0]).toBe('-c');
      expect(flags[1]).toBe('credential.helper=');
      expect(flags[3]).toMatch(/^credential\.helper=!f\(\)/);
    });

    it('is a no-op without a token', () => {
      expect(cloneFetchAuthArgs(connection)).toEqual({ flags: [] });
    });
  });

  describe('fetchWithAuth', () => {
    it('fetches remote heads into refs/remotes/origin/*', async () => {
      const bare = path.join(conduitHome, 'base-clones', 'test.git');
      await ensureBaseClone(bare, connection);

      await git(['checkout', '-q', '-b', 'feature-x'], { cwd: remote });
      await fs.writeFile(path.join(remote, 'feature.ts'), 'export const x = 1;\n');
      await git(['add', '-A'], { cwd: remote });
      await git(['commit', '-q', '-m', 'feature'], { cwd: remote });
      await git(['checkout', '-q', 'main'], { cwd: remote });

      await fetchWithAuth(bare, connection);

      const refs = await git(['show-ref'], { cwd: bare });
      expect(refs).toContain('refs/remotes/origin/feature-x');
      expect(refs).toContain('refs/remotes/origin/main');
    });
  });

  describe('remoteBranchExists', () => {
    it('returns true for an existing ref', async () => {
      const bare = path.join(conduitHome, 'base-clones', 'test.git');
      await ensureBaseClone(bare, connection);
      await fetchWithAuth(bare, connection);

      expect(await remoteBranchExists(bare, 'main')).toBe(true);
    });

    it('returns false for a non-existent ref', async () => {
      const bare = path.join(conduitHome, 'base-clones', 'test.git');
      await ensureBaseClone(bare, connection);
      await fetchWithAuth(bare, connection);

      expect(await remoteBranchExists(bare, 'does-not-exist')).toBe(false);
    });

    it('returns false (not throw) when show-ref fails', async () => {
      const bare = path.join(conduitHome, 'base-clones', 'test.git');
      await ensureBaseClone(bare, connection);

      expect(await remoteBranchExists(bare, 'no-such-branch')).toBe(false);
    });
  });

  describe('defaultBranch', () => {
    it('returns the symbolic HEAD', async () => {
      const bare = path.join(conduitHome, 'base-clones', 'test.git');
      await ensureBaseClone(bare, connection);

      expect(await defaultBranch(bare)).toBe('main');
    });

    it('returns "main" when symbolic-ref fails', async () => {
      const emptyDir = path.join(conduitHome, 'empty');
      await fs.mkdir(emptyDir, { recursive: true });

      expect(await defaultBranch(emptyDir)).toBe('main');
    });
  });

  describe('stripRemoteAuth', () => {
    it('sets the remote URL to the clean URL', async () => {
      const bare = path.join(conduitHome, 'base-clones', 'test.git');
      await ensureBaseClone(bare, connection);

      const worktreeTarget = path.join(conduitHome, 'runs', 'run_strip', 'Worker');
      await fs.mkdir(path.dirname(worktreeTarget), { recursive: true });
      await fetchWithAuth(bare, connection);
      await addTrackingWorktree(bare, worktreeTarget, 'main');

      await stripRemoteAuth(worktreeTarget, 'https://github.com/acme/shop.git');
      const url = (await git(['remote', 'get-url', 'origin'], { cwd: worktreeTarget })).trim();
      expect(url).toBe('https://github.com/acme/shop.git');
    });
  });

  describe('addTrackingWorktree', () => {
    it('creates a worktree on an existing remote-tracking ref', async () => {
      const bare = path.join(conduitHome, 'base-clones', 'test.git');
      await ensureBaseClone(bare, connection);
      await fetchWithAuth(bare, connection);

      const worktreeTarget = path.join(conduitHome, 'runs', 'run_add', 'Worker');
      await fs.mkdir(path.dirname(worktreeTarget), { recursive: true });

      await addTrackingWorktree(bare, worktreeTarget, 'main');

      const readme = await fs.readFile(path.join(worktreeTarget, 'README.md'), 'utf8');
      expect(readme).toBe('# Seed\n');
    });

    it('recovers from a stale worktree registration (drop + retry)', async () => {
      const bare = path.join(conduitHome, 'base-clones', 'test.git');
      await ensureBaseClone(bare, connection);
      await fetchWithAuth(bare, connection);

      const worktreeTarget = path.join(conduitHome, 'runs', 'run_stale', 'Worker');
      await fs.mkdir(path.dirname(worktreeTarget), { recursive: true });

      await addTrackingWorktree(bare, worktreeTarget, 'main');
      // Remove the worktree directory without unregistering — simulates a crash.
      await fs.rm(worktreeTarget, { recursive: true, force: true });

      // Second add on the same path/branch should recover via drop+retry.
      await addTrackingWorktree(bare, worktreeTarget, 'main');
      const readme = await fs.readFile(path.join(worktreeTarget, 'README.md'), 'utf8');
      expect(readme).toBe('# Seed\n');
    });
  });

  describe('createTrackingWorktree', () => {
    it('creates a new branch off a base ref', async () => {
      const bare = path.join(conduitHome, 'base-clones', 'test.git');
      await ensureBaseClone(bare, connection);
      await fetchWithAuth(bare, connection);

      const worktreeTarget = path.join(conduitHome, 'runs', 'run_create', 'Worker');
      await fs.mkdir(path.dirname(worktreeTarget), { recursive: true });

      await createTrackingWorktree(bare, worktreeTarget, 'conduit/42-new-feature', 'main');

      const readme = await fs.readFile(path.join(worktreeTarget, 'README.md'), 'utf8');
      expect(readme).toBe('# Seed\n');

      const branch = (
        await git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktreeTarget })
      ).trim();
      expect(branch).toBe('conduit/42-new-feature');
    });

    it('recovers from a stale local branch ref', async () => {
      const bare = path.join(conduitHome, 'base-clones', 'test.git');
      await ensureBaseClone(bare, connection);
      await fetchWithAuth(bare, connection);

      const first = path.join(conduitHome, 'runs', 'run_first', 'Worker');
      await fs.mkdir(path.dirname(first), { recursive: true });
      await createTrackingWorktree(bare, first, 'conduit/99-stale', 'main');

      // Remove the worktree directory without unregistering — simulates a crash
      // leaving a stale branch ref behind.
      await fs.rm(first, { recursive: true, force: true });

      const second = path.join(conduitHome, 'runs', 'run_second', 'Worker');
      await fs.mkdir(path.dirname(second), { recursive: true });
      await createTrackingWorktree(bare, second, 'conduit/99-stale', 'main');

      const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: second })).trim();
      expect(branch).toBe('conduit/99-stale');
    });
  });
});
