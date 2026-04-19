import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MergeConflictError,
  WorkspaceManager,
  copyConduitSummaries,
  mergeBranchedWorktree,
  readConduitSummary,
} from '../../src/index';

/**
 * Exercises the real-git bits of Phase 3 against a seeded local repo:
 *
 *   1. `repo-clone` seeds a worktree off a local bare repo.
 *   2. Parallel-branched `inherit` creates sibling worktrees off the
 *      upstream HEAD.
 *   3. Agents commit different files in each sibling; merge-back folds
 *      both commits into the upstream without conflict.
 *   4. `.conduit/<Node>.md` files copy from sibling worktrees into the
 *      upstream so downstream agents see every sibling summary.
 */

const exec = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd });
  return stdout;
}

describe('parallel `inherit` + merge-back + .conduit copy', () => {
  let home: string;
  let bareRepo: string;
  let originalConduitHome: string | undefined;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'conduit-int-'));
    originalConduitHome = process.env.CONDUIT_HOME;
    process.env.CONDUIT_HOME = home;

    // Build a local seed clone + bare remote under the workspace manager's
    // expected `base-clones/github/<owner>/<repo>.git` path so `repoClone()`
    // doesn't try to hit the network.
    const seed = path.join(home, 'seed');
    await fs.mkdir(seed, { recursive: true });
    await git(seed, 'init', '-q', '-b', 'main');
    await git(seed, 'config', 'user.email', 'seed@conduit.test');
    await git(seed, 'config', 'user.name', 'Seed');
    await fs.writeFile(path.join(seed, 'README.md'), '# seed\n');
    await git(seed, 'add', '-A');
    await git(seed, 'commit', '-q', '-m', 'seed');

    bareRepo = path.join(home, 'base-clones', 'github', 'acme', 'shop.git');
    await fs.mkdir(path.dirname(bareRepo), { recursive: true });
    await git(path.dirname(bareRepo), 'clone', '--bare', '-q', seed, bareRepo);
    await git(bareRepo, 'remote', 'set-url', 'origin', seed);
  });

  afterEach(async () => {
    if (originalConduitHome === undefined) delete process.env.CONDUIT_HOME;
    else process.env.CONDUIT_HOME = originalConduitHome;
    await fs.rm(home, { recursive: true, force: true });
  });

  it('branches parallel inheritors off upstream HEAD and merges them back cleanly', async () => {
    const manager = new WorkspaceManager();
    const runId = 'test-run-parallel';

    const triage = await manager.resolve({
      runId,
      nodeName: 'Triage',
      spec: { kind: 'repo-clone', connectionId: 'conn-1' },
      connection: {
        id: 'conn-1',
        platform: 'github',
        owner: 'acme',
        repo: 'shop',
        cloneUrl: 'file://does-not-matter',
      },
    });
    expect(triage.head).toBeTruthy();

    // Simulate Triage writing its summary in its own workspace.
    await fs.mkdir(path.join(triage.path, '.conduit'), { recursive: true });
    await fs.writeFile(path.join(triage.path, '.conduit', 'Triage.md'), '# triage\n');

    const fix = await manager.resolve({
      runId,
      nodeName: 'Fix',
      spec: { kind: 'inherit', fromNode: 'Triage' },
      upstreamPath: triage.path,
      upstreamHead: triage.head,
      parallelBranch: true,
    });
    const doc = await manager.resolve({
      runId,
      nodeName: 'Doc',
      spec: { kind: 'inherit', fromNode: 'Triage' },
      upstreamPath: triage.path,
      upstreamHead: triage.head,
      parallelBranch: true,
    });

    // Siblings are distinct detached worktrees carved off Triage's HEAD.
    expect(fix.path).not.toBe(triage.path);
    expect(doc.path).not.toBe(triage.path);
    expect(fix.path).not.toBe(doc.path);
    expect(fix.isBranchedWorktree).toBe(true);
    expect(doc.isBranchedWorktree).toBe(true);

    // Each sibling commits a different file + writes a .conduit summary.
    await fs.writeFile(path.join(fix.path, 'src_fix.ts'), 'export const fixed = true;\n');
    await fs.mkdir(path.join(fix.path, '.conduit'), { recursive: true });
    await fs.writeFile(path.join(fix.path, '.conduit', 'Fix.md'), '# fix\n');

    await fs.writeFile(path.join(doc.path, 'CHANGELOG.md'), '# changelog\n');
    await fs.mkdir(path.join(doc.path, '.conduit'), { recursive: true });
    await fs.writeFile(path.join(doc.path, '.conduit', 'Doc.md'), '# doc\n');

    // Commit in each sibling (the merge activity handles staging in the
    // real worker, but at the manager level we commit manually here).
    for (const ws of [fix, doc]) {
      await git(ws.path, 'add', '-A');
      await git(ws.path, 'reset', '--quiet', 'HEAD', '--', '.conduit').catch(() => undefined);
      await git(ws.path, '-c', 'user.email=a@b', '-c', 'user.name=Test', 'commit', '-q', '-m', 'change');
    }

    const fixHead = (await git(fix.path, 'rev-parse', 'HEAD')).trim();
    const docHead = (await git(doc.path, 'rev-parse', 'HEAD')).trim();

    // Sequential merge-back into Triage — deterministic order (Fix, Doc).
    await mergeBranchedWorktree({
      targetWorkspacePath: triage.path,
      sourceRef: fixHead,
      sourceNodeName: 'Fix',
    });
    await mergeBranchedWorktree({
      targetWorkspacePath: triage.path,
      sourceRef: docHead,
      sourceNodeName: 'Doc',
    });

    // Both siblings' files land in the merged Triage worktree.
    await expect(fs.readFile(path.join(triage.path, 'src_fix.ts'), 'utf8')).resolves.toContain(
      'fixed = true',
    );
    await expect(fs.readFile(path.join(triage.path, 'CHANGELOG.md'), 'utf8')).resolves.toContain(
      'changelog',
    );

    // copyConduitSummaries lifts each sibling's .conduit file into the
    // merged upstream. `.conduit` is gitignored-by-design; we never carry
    // it through git.
    const copied = await copyConduitSummaries(
      [
        { nodeName: 'Fix', workspacePath: fix.path },
        { nodeName: 'Doc', workspacePath: doc.path },
      ],
      triage.path,
    );
    expect(copied).toEqual(expect.arrayContaining(['Fix', 'Doc']));
    await expect(readConduitSummary(triage.path, 'Fix')).resolves.toMatch(/# fix/);
    await expect(readConduitSummary(triage.path, 'Doc')).resolves.toMatch(/# doc/);
  });

  it('throws MergeConflictError when two siblings edit the same file incompatibly', async () => {
    const manager = new WorkspaceManager();
    const runId = 'test-run-conflict';

    const triage = await manager.resolve({
      runId,
      nodeName: 'Triage',
      spec: { kind: 'repo-clone', connectionId: 'conn-1' },
      connection: {
        id: 'conn-1',
        platform: 'github',
        owner: 'acme',
        repo: 'shop',
        cloneUrl: 'file://does-not-matter',
      },
    });
    await fs.writeFile(path.join(triage.path, 'shared.txt'), 'base\n');
    await git(triage.path, 'add', '-A');
    await git(
      triage.path,
      '-c',
      'user.email=a@b',
      '-c',
      'user.name=Test',
      'commit',
      '-q',
      '-m',
      'base',
    );
    const triageHead = (await git(triage.path, 'rev-parse', 'HEAD')).trim();

    const fix = await manager.resolve({
      runId,
      nodeName: 'Fix',
      spec: { kind: 'inherit', fromNode: 'Triage' },
      upstreamPath: triage.path,
      upstreamHead: triageHead,
      parallelBranch: true,
    });
    const doc = await manager.resolve({
      runId,
      nodeName: 'Doc',
      spec: { kind: 'inherit', fromNode: 'Triage' },
      upstreamPath: triage.path,
      upstreamHead: triageHead,
      parallelBranch: true,
    });

    await fs.writeFile(path.join(fix.path, 'shared.txt'), 'fix version\n');
    await fs.writeFile(path.join(doc.path, 'shared.txt'), 'doc version\n');
    for (const ws of [fix, doc]) {
      await git(ws.path, 'add', '-A');
      await git(ws.path, '-c', 'user.email=a@b', '-c', 'user.name=Test', 'commit', '-q', '-m', 'change');
    }

    const fixHead = (await git(fix.path, 'rev-parse', 'HEAD')).trim();
    const docHead = (await git(doc.path, 'rev-parse', 'HEAD')).trim();

    await mergeBranchedWorktree({
      targetWorkspacePath: triage.path,
      sourceRef: fixHead,
      sourceNodeName: 'Fix',
    });
    await expect(
      mergeBranchedWorktree({
        targetWorkspacePath: triage.path,
        sourceRef: docHead,
        sourceNodeName: 'Doc',
      }),
    ).rejects.toBeInstanceOf(MergeConflictError);

    // The failed merge was aborted — the target worktree is clean.
    const status = (await git(triage.path, 'status', '--porcelain')).trim();
    expect(status).toBe('');
  });
});
