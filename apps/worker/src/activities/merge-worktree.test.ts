import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeWorktreeActivity } from './merge-worktree';
import { writeSystemLog } from '../runtime/log-writer';

vi.mock('../runtime/log-writer', () => ({
  writeSystemLog: vi.fn().mockResolvedValue(undefined),
}));

const exec = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd });
  return stdout;
}

async function commit(cwd: string, message: string): Promise<void> {
  await git(cwd, 'add', '-A');
  await git(
    cwd,
    '-c',
    'user.email=test@conduit.local',
    '-c',
    'user.name=Test',
    'commit',
    '-q',
    '-m',
    message,
  );
}

interface Fixture {
  root: string;
  target: string;
  source: string;
  originalEnv: Record<string, string | undefined>;
}

async function setupWorktreePair(opts: { prefix: string; gitignore: string | null }): Promise<Fixture> {
  vi.clearAllMocks();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), opts.prefix));
  const target = path.join(root, 'target');
  const source = path.join(root, 'source');
  await fs.mkdir(target, { recursive: true });
  await git(target, 'init', '-q', '-b', 'main');
  if (opts.gitignore !== null) {
    await fs.writeFile(path.join(target, '.gitignore'), opts.gitignore);
  }
  await fs.mkdir(path.join(target, 'src'), { recursive: true });
  await fs.writeFile(path.join(target, 'src', 'base.ts'), 'export const base = true;\n');
  await commit(target, 'base');
  await git(target, 'worktree', 'add', '--detach', source, 'HEAD');

  const originalEnv = {
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
    HOME: process.env.HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  };
  process.env.GIT_CONFIG_GLOBAL = path.join(root, 'missing-global-gitconfig');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.HOME = path.join(root, 'empty-home');
  process.env.XDG_CONFIG_HOME = path.join(root, 'empty-xdg');

  return { root, target, source, originalEnv };
}

async function teardownWorktreePair(fixture: Fixture): Promise<void> {
  for (const [key, value] of Object.entries(fixture.originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(fixture.root, { recursive: true, force: true });
}

describe('mergeWorktreeActivity', () => {
  let root: string;
  let target: string;
  let source: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    ({ root, target, source, originalEnv } = await setupWorktreePair({
      prefix: 'conduit-merge-activity-',
      gitignore: '*.png\n.conduit/\n',
    }));
  });

  afterEach(async () => {
    await teardownWorktreePair({ root, target, source, originalEnv });
  });

  it('ignores .conduit and gitignored transient files when nothing else changed', async () => {
    await fs.mkdir(path.join(source, '.conduit'), { recursive: true });
    await fs.writeFile(path.join(source, '.conduit', 'Fix.md'), '# Fix\n');
    await fs.writeFile(path.join(source, 'playwright.png'), 'not really a png\n');

    await mergeWorktreeActivity(input());

    const targetHead = (await git(target, 'rev-parse', 'HEAD')).trim();
    const sourceHead = (await git(source, 'rev-parse', 'HEAD')).trim();
    expect(targetHead).toBe(sourceHead);
    expect(writeSystemLog).toHaveBeenCalledWith(
      'run-1',
      'org-test',
      'Triage',
      'merge Fix → Triage: no new commits, skipping',
      undefined,
    );
  });

  it('commits and merges source changes without committing ignored files', async () => {
    const baseHead = (await git(target, 'rev-parse', 'HEAD')).trim();
    await fs.writeFile(path.join(source, 'src', 'fix.ts'), 'export const fixed = true;\n');
    await fs.writeFile(path.join(source, 'playwright.png'), 'not really a png\n');

    await mergeWorktreeActivity(input());

    await expect(fs.readFile(path.join(target, 'src', 'fix.ts'), 'utf8')).resolves.toContain(
      'fixed = true',
    );
    await expect(fs.stat(path.join(target, 'playwright.png'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const mergeAuthor = (await git(target, 'log', '-1', '--pretty=%an <%ae>')).trim();
    const mergeSubject = (await git(target, 'log', '-1', '--pretty=%s')).trim();
    const targetHead = (await git(target, 'rev-parse', 'HEAD')).trim();
    expect(mergeAuthor).toBe('Conduit <conduit@local>');
    expect(mergeSubject).toBe('Conduit: merge Fix');
    expect(targetHead).not.toBe(baseHead);
  });

  it('respects source .gitignore listing .conduit/ alongside a real change', async () => {
    await fs.mkdir(path.join(source, '.conduit'), { recursive: true });
    await fs.writeFile(path.join(source, '.conduit', 'Fix.md'), '# Fix\n');
    await fs.writeFile(path.join(source, 'src', 'fix.ts'), 'export const fixed = true;\n');

    await mergeWorktreeActivity(input());

    await expect(fs.readFile(path.join(target, 'src', 'fix.ts'), 'utf8')).resolves.toContain(
      'fixed = true',
    );
    await expect(fs.stat(path.join(target, '.conduit'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('scrubs .conduit/ that the agent committed during its session', async () => {
    await fs.writeFile(path.join(source, 'src', 'feature.ts'), 'export const feat = true;\n');
    await commit(source, 'agent: feature');
    await fs.mkdir(path.join(source, '.conduit'), { recursive: true });
    await fs.writeFile(path.join(source, '.conduit', 'Notes.md'), '# leaked\n');
    // Bypass the source's .gitignore the same way an agent shell could:
    // `git add -f` then commit. This puts `.conduit/Notes.md` in source's
    // history; the merge-back must keep it out of target's tree AND log.
    await git(source, 'add', '-f', '.conduit/Notes.md');
    await git(
      source,
      '-c',
      'user.email=test@conduit.local',
      '-c',
      'user.name=Test',
      'commit',
      '-q',
      '-m',
      'agent: leaked .conduit',
    );

    await mergeWorktreeActivity(input());

    await expect(fs.readFile(path.join(target, 'src', 'feature.ts'), 'utf8')).resolves.toContain(
      'feat = true',
    );
    await expect(fs.stat(path.join(target, '.conduit'))).rejects.toMatchObject({ code: 'ENOENT' });
    const trackedConduit = (await git(target, 'ls-files', '--', '.conduit')).trim();
    expect(trackedConduit).toBe('');
    // Target's HEAD ancestry must not reference `.conduit/` — the squash
    // doesn't link source's commits as parents, so `git log -- .conduit`
    // (without --all) walks only target's history and finds nothing.
    const historyConduit = (await git(target, 'log', '--', '.conduit')).trim();
    expect(historyConduit).toBe('');
  });

  function input() {
    return {
      runId: 'run-1',
      orgId: 'org-test',
      sourceWorkspacePath: source,
      targetWorkspacePath: target,
      sourceNodeName: 'Fix',
      targetNodeName: 'Triage',
    };
  }
});

describe('mergeWorktreeActivity — repo without a .gitignore', () => {
  // Without `.conduit/` gitignored, source's `git add -A` stages it into
  // the snapshot commit. Combined with cloneConduitFolder seeding the
  // upstream's summary into both worktrees, target ends up with the same
  // `.conduit/<Upstream>.md` as untracked while source's snapshot commit
  // also contains it — a naive squash trips the untracked-overwrite
  // preflight. The merge-back must preserve target's own summary while
  // still scrubbing source-side `.conduit/` leaks from tree and history.
  let root: string;
  let target: string;
  let source: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    ({ root, target, source, originalEnv } = await setupWorktreePair({
      prefix: 'conduit-merge-activity-no-gi-',
      gitignore: null,
    }));
  });

  afterEach(async () => {
    await teardownWorktreePair({ root, target, source, originalEnv });
  });

  it("preserves target's pre-existing untracked .conduit/ when source's snapshot collides", async () => {
    await fs.mkdir(path.join(target, '.conduit'), { recursive: true });
    await fs.writeFile(path.join(target, '.conduit', 'Triage.md'), '# Triage\n\nupstream\n');
    await fs.mkdir(path.join(source, '.conduit'), { recursive: true });
    await fs.writeFile(path.join(source, '.conduit', 'Triage.md'), '# Triage\n\nupstream\n');
    await fs.writeFile(path.join(source, '.conduit', 'Fix.md'), '# Fix\n');
    await fs.writeFile(path.join(source, 'src', 'fix.ts'), 'export const fixed = true;\n');

    await mergeWorktreeActivity({
      runId: 'run-1',
      orgId: 'org-test',
      sourceWorkspacePath: source,
      targetWorkspacePath: target,
      sourceNodeName: 'Fix',
      targetNodeName: 'Triage',
    });

    await expect(fs.readFile(path.join(target, '.conduit', 'Triage.md'), 'utf8')).resolves.toContain(
      'upstream',
    );
    await expect(fs.stat(path.join(target, '.conduit', 'Fix.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.readFile(path.join(target, 'src', 'fix.ts'), 'utf8')).resolves.toContain(
      'fixed = true',
    );
    const trackedConduit = (await git(target, 'ls-files', '--', '.conduit')).trim();
    expect(trackedConduit).toBe('');
    const historyConduit = (await git(target, 'log', '--', '.conduit')).trim();
    expect(historyConduit).toBe('');
  });
});
