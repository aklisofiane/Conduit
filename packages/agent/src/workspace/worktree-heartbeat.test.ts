import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONDUIT_DIR } from './conduit-folder';
import {
  WORKTREE_HEARTBEAT_INTERVAL_MS,
  WORKTREE_STALE_MS,
  isWorktreeAlive,
  touchWorktreeHeartbeat,
} from './worktree-heartbeat';

describe('worktree-heartbeat', () => {
  let worktree: string;

  beforeEach(async () => {
    worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'conduit-heartbeat-'));
  });

  afterEach(async () => {
    await fs.rm(worktree, { recursive: true, force: true });
  });

  const heartbeatFile = () => path.join(worktree, CONDUIT_DIR, '.heartbeat');

  describe('constants', () => {
    it('exports the documented touch cadence and a 4x stale threshold', () => {
      expect(WORKTREE_HEARTBEAT_INTERVAL_MS).toBe(30_000);
      expect(WORKTREE_STALE_MS).toBe(120_000);
      expect(WORKTREE_STALE_MS).toBe(WORKTREE_HEARTBEAT_INTERVAL_MS * 4);
    });
  });

  describe('touchWorktreeHeartbeat', () => {
    it('creates .conduit/.heartbeat (and the .conduit dir) when neither exists', async () => {
      await touchWorktreeHeartbeat(worktree);

      const stat = await fs.stat(heartbeatFile());
      expect(stat.isFile()).toBe(true);
    });

    it('refreshes (bumps) the mtime of an existing heartbeat rather than truncating it', async () => {
      // Seed a heartbeat with some content and an old mtime.
      await fs.mkdir(path.join(worktree, CONDUIT_DIR), { recursive: true });
      await fs.writeFile(heartbeatFile(), 'sentinel', 'utf8');
      const old = new Date(Date.now() - WORKTREE_STALE_MS * 2);
      await fs.utimes(heartbeatFile(), old, old);

      await touchWorktreeHeartbeat(worktree);

      const stat = await fs.stat(heartbeatFile());
      // mtime bumped forward...
      expect(stat.mtimeMs).toBeGreaterThan(old.getTime());
      expect(Date.now() - stat.mtimeMs).toBeLessThan(5_000);
      // ...and the file was not truncated (opened with 'a', not 'w').
      const body = await fs.readFile(heartbeatFile(), 'utf8');
      expect(body).toBe('sentinel');
    });

    it('never throws when the target path is unwritable/invalid', async () => {
      // A file where a directory is expected makes mkdir/open fail.
      const blocker = path.join(worktree, 'blocker');
      await fs.writeFile(blocker, 'x', 'utf8');
      const badWorktree = path.join(blocker, 'nested');

      await expect(touchWorktreeHeartbeat(badWorktree)).resolves.toBeUndefined();
    });
  });

  describe('isWorktreeAlive', () => {
    it('returns true for a heartbeat whose mtime is within staleMs of now', async () => {
      await touchWorktreeHeartbeat(worktree);

      expect(await isWorktreeAlive(worktree)).toBe(true);
    });

    it('returns false when the heartbeat mtime is older than staleMs', async () => {
      await touchWorktreeHeartbeat(worktree);
      const old = new Date(Date.now() - (WORKTREE_STALE_MS + 60_000));
      await fs.utimes(heartbeatFile(), old, old);

      expect(await isWorktreeAlive(worktree)).toBe(false);
    });

    it('honors a custom staleMs threshold at the boundary', async () => {
      await touchWorktreeHeartbeat(worktree);
      const tenSecAgo = new Date(Date.now() - 10_000);
      await fs.utimes(heartbeatFile(), tenSecAgo, tenSecAgo);

      // 10s-old heartbeat is dead under a 5s window, alive under a 60s window.
      expect(await isWorktreeAlive(worktree, 5_000)).toBe(false);
      expect(await isWorktreeAlive(worktree, 60_000)).toBe(true);
    });

    it('returns false when the heartbeat file does not exist', async () => {
      expect(await isWorktreeAlive(worktree)).toBe(false);
    });
  });
});
