import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git } from './git';
import { MergeConflictError, mergeBranchedWorktree } from './merge';

/**
 * Real-git tests (no mocking, same approach as git-helpers.test.ts) for the
 * squash merge-back path: source history never enters target, `.conduit/`
 * committed by the agent is stripped, target's own `.conduit/` handoffs
 * survive, and a conflict leaves target exactly where it started.
 *
 * Fixture: one repo where `main` is the target worktree and `source` is the
 * parallel branch being landed — `mergeBranchedWorktree` only needs
 * `sourceRef` to resolve from target's repo, which matches production
 * (worktrees sharing one base clone share refs).
 */
describe('mergeBranchedWorktree', () => {
  let repo: string;

  async function commitAll(message: string): Promise<void> {
    await git(['add', '-A'], { cwd: repo });
    await git(['commit', '-q', '-m', message], { cwd: repo });
  }

  async function headCount(): Promise<number> {
    return Number.parseInt(await git(['rev-list', '--count', 'HEAD'], { cwd: repo }), 10);
  }

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'conduit-merge-'));
    await git(['init', '-q', '-b', 'main'], { cwd: repo });
    await git(['config', 'user.email', 'seed@conduit.test'], { cwd: repo });
    await git(['config', 'user.name', 'Seed'], { cwd: repo });
    await fs.writeFile(path.join(repo, 'app.txt'), 'base\n');
    await commitAll('seed');
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it('squashes source into a single commit on target', async () => {
    await git(['checkout', '-q', '-b', 'source'], { cwd: repo });
    await fs.writeFile(path.join(repo, 'feature.txt'), 'one\n');
    await commitAll('source: step 1');
    await fs.appendFile(path.join(repo, 'feature.txt'), 'two\n');
    await commitAll('source: step 2');
    await git(['checkout', '-q', 'main'], { cwd: repo });
    const before = await headCount();

    await mergeBranchedWorktree({
      targetWorkspacePath: repo,
      sourceRef: 'source',
      sourceNodeName: 'Source',
    });

    expect(await fs.readFile(path.join(repo, 'feature.txt'), 'utf8')).toBe('one\ntwo\n');
    // Exactly one new commit — source's per-step history stays out of main.
    expect(await headCount()).toBe(before + 1);
    const subject = await git(['log', '-1', '--format=%s'], { cwd: repo });
    expect(subject.trim()).toBe('Conduit: merge Source');
  });

  it('strips agent-committed .conduit/ files from index and working tree, sparing target handoffs', async () => {
    await git(['checkout', '-q', '-b', 'source'], { cwd: repo });
    await fs.writeFile(path.join(repo, 'feature.txt'), 'work\n');
    await fs.mkdir(path.join(repo, '.conduit'), { recursive: true });
    await fs.writeFile(path.join(repo, '.conduit', 'Source.md'), 'agent summary\n');
    await fs.writeFile(path.join(repo, '.conduit', 'Upstream.md'), 'source copy\n');
    await commitAll('source work incl. .conduit');
    await git(['checkout', '-q', 'main'], { cwd: repo });
    // Target's own handoff (what cloneConduitFolder leaves) — untracked.
    await fs.mkdir(path.join(repo, '.conduit'), { recursive: true });
    await fs.writeFile(path.join(repo, '.conduit', 'Upstream.md'), 'target copy\n');

    await mergeBranchedWorktree({
      targetWorkspacePath: repo,
      sourceRef: 'source',
      sourceNodeName: 'Source',
    });

    // Nothing under .conduit/ is tracked on target…
    const tracked = await git(['ls-files', '--', '.conduit'], { cwd: repo });
    expect(tracked.trim()).toBe('');
    // …the agent's own summary is gone from the working tree…
    await expect(fs.access(path.join(repo, '.conduit', 'Source.md'))).rejects.toThrow();
    // …but the basename target already had survives for downstream nodes.
    await expect(fs.access(path.join(repo, '.conduit', 'Upstream.md'))).resolves.toBeUndefined();
    // The real change landed.
    await expect(fs.access(path.join(repo, 'feature.txt'))).resolves.toBeUndefined();
  });

  it('skips the commit when the only diff is .conduit/', async () => {
    await git(['checkout', '-q', '-b', 'source'], { cwd: repo });
    await fs.mkdir(path.join(repo, '.conduit'), { recursive: true });
    await fs.writeFile(path.join(repo, '.conduit', 'Source.md'), 'runtime-only state\n');
    await commitAll('source: conduit only');
    await git(['checkout', '-q', 'main'], { cwd: repo });
    const before = await headCount();

    await mergeBranchedWorktree({
      targetWorkspacePath: repo,
      sourceRef: 'source',
      sourceNodeName: 'Source',
    });

    // HEAD didn't churn and the index is clean.
    expect(await headCount()).toBe(before);
    const status = await git(['status', '--porcelain'], { cwd: repo });
    expect(status.trim()).toBe('');
  });

  it('throws MergeConflictError with the conflicted paths and resets target clean', async () => {
    await git(['checkout', '-q', '-b', 'source'], { cwd: repo });
    await fs.writeFile(path.join(repo, 'app.txt'), 'source version\n');
    await commitAll('source: edit app');
    await git(['checkout', '-q', 'main'], { cwd: repo });
    await fs.writeFile(path.join(repo, 'app.txt'), 'target version\n');
    await commitAll('target: edit app');
    const before = await headCount();

    await expect(
      mergeBranchedWorktree({
        targetWorkspacePath: repo,
        sourceRef: 'source',
        sourceNodeName: 'Source',
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        name: 'MergeConflictError',
        conflicts: ['app.txt'],
      }) as MergeConflictError,
    );

    // `reset --hard` cleared the partial squash: clean status, HEAD and
    // content exactly as before the attempt.
    const status = await git(['status', '--porcelain'], { cwd: repo });
    expect(status.trim()).toBe('');
    expect(await headCount()).toBe(before);
    expect(await fs.readFile(path.join(repo, 'app.txt'), 'utf8')).toBe('target version\n');
  });
});
