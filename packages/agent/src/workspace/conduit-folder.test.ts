import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CONDUIT_DIR,
  clearConduitFolder,
  cloneConduitFolder,
  copyConduitSummaries,
  isNotFound,
  readConduitSummaries,
} from './conduit-folder';

describe('conduit-folder', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'conduit-folder-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  /** Write `<workspace>/.conduit/<rel>` with `body`, creating parents. */
  async function writeConduit(workspace: string, rel: string, body: string): Promise<void> {
    const file = path.join(workspace, CONDUIT_DIR, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body, 'utf8');
  }

  async function makeWorkspace(name: string): Promise<string> {
    const ws = path.join(root, name);
    await fs.mkdir(ws, { recursive: true });
    return ws;
  }

  describe('readConduitSummaries', () => {
    it('returns { nodeName, body } per .md, strips .md, ignores non-md files and subdirs', async () => {
      const ws = await makeWorkspace('reader');
      await writeConduit(ws, 'Design.md', 'design body');
      await writeConduit(ws, 'Review.md', 'review body');
      await writeConduit(ws, 'notes.txt', 'ignored');
      await fs.mkdir(path.join(ws, CONDUIT_DIR, 'Nested.md'), { recursive: true });

      const summaries = await readConduitSummaries(ws);

      expect(summaries).toHaveLength(2);
      expect(summaries).toContainEqual({ nodeName: 'Design', body: 'design body' });
      expect(summaries).toContainEqual({ nodeName: 'Review', body: 'review body' });
    });

    it('returns [] when the .conduit dir is absent (readdir rejection swallowed)', async () => {
      const ws = await makeWorkspace('empty');
      expect(await readConduitSummaries(ws)).toEqual([]);
    });
  });

  describe('copyConduitSummaries', () => {
    it('copies each source summary into target/.conduit, creates the dir, returns copied names', async () => {
      const srcA = await makeWorkspace('srcA');
      const srcB = await makeWorkspace('srcB');
      await writeConduit(srcA, 'A.md', 'a body');
      await writeConduit(srcB, 'B.md', 'b body');
      const target = await makeWorkspace('target');

      const copied = await copyConduitSummaries(
        [
          { nodeName: 'A', workspacePath: srcA },
          { nodeName: 'B', workspacePath: srcB },
        ],
        target,
      );

      expect(copied.sort()).toEqual(['A', 'B']);
      expect(await fs.readFile(path.join(target, CONDUIT_DIR, 'A.md'), 'utf8')).toBe('a body');
      expect(await fs.readFile(path.join(target, CONDUIT_DIR, 'B.md'), 'utf8')).toBe('b body');
    });

    it('skips a source whose summary file is missing, without throwing', async () => {
      const present = await makeWorkspace('present');
      const missing = await makeWorkspace('missing');
      await writeConduit(present, 'Present.md', 'present body');
      const target = await makeWorkspace('target2');

      const copied = await copyConduitSummaries(
        [
          { nodeName: 'Present', workspacePath: present },
          { nodeName: 'Missing', workspacePath: missing },
        ],
        target,
      );

      expect(copied).toEqual(['Present']);
      await expect(fs.access(path.join(target, CONDUIT_DIR, 'Missing.md'))).rejects.toThrow();
    });
  });

  describe('clearConduitFolder', () => {
    it('removes an existing .conduit dir', async () => {
      const ws = await makeWorkspace('toclear');
      await writeConduit(ws, 'X.md', 'x');

      await clearConduitFolder(ws);

      await expect(fs.access(path.join(ws, CONDUIT_DIR))).rejects.toThrow();
    });

    it('is a no-op (no throw) when .conduit is already absent', async () => {
      const ws = await makeWorkspace('noclear');
      await expect(clearConduitFolder(ws)).resolves.toBeUndefined();
    });
  });

  describe('cloneConduitFolder', () => {
    it('recursively copies upstream .conduit into target', async () => {
      const upstream = await makeWorkspace('upstream');
      await writeConduit(upstream, 'Up.md', 'up body');
      await writeConduit(upstream, 'sub/Deep.md', 'deep body');
      const target = await makeWorkspace('clonetarget');

      await cloneConduitFolder(upstream, target);

      expect(await fs.readFile(path.join(target, CONDUIT_DIR, 'Up.md'), 'utf8')).toBe('up body');
      expect(await fs.readFile(path.join(target, CONDUIT_DIR, 'sub', 'Deep.md'), 'utf8')).toBe(
        'deep body',
      );
    });

    it('is a no-op when source .conduit is absent (ENOENT swallowed)', async () => {
      const upstream = await makeWorkspace('noupstream');
      const target = await makeWorkspace('clonetarget2');

      await expect(cloneConduitFolder(upstream, target)).resolves.toBeUndefined();
      await expect(fs.access(path.join(target, CONDUIT_DIR))).rejects.toThrow();
    });
  });

  describe('isNotFound', () => {
    it('returns true only for an object with code ENOENT', () => {
      expect(isNotFound({ code: 'ENOENT' })).toBe(true);
    });

    it('returns false for other errors and non-error values', () => {
      expect(isNotFound({ code: 'EACCES' })).toBe(false);
      expect(isNotFound(new Error('boom'))).toBe(false);
      expect(isNotFound(null)).toBe(false);
      expect(isNotFound(undefined)).toBe(false);
      expect(isNotFound('ENOENT')).toBe(false);
    });
  });
});
