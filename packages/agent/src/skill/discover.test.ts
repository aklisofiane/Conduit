import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverSkills } from './discover';

describe('discoverSkills', () => {
  let home: string;
  let repo: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    // Point HOME at an empty temp dir so no host-level worker/plugin roots
    // (`~/.claude/skills`, installed plugins) bleed into the result — `os.homedir()`
    // reads HOME on POSIX, making discovery deterministic.
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'conduit-discover-home-'));
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'conduit-discover-repo-'));
    originalHome = process.env.HOME;
    process.env.HOME = home;
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(repo, { recursive: true, force: true });
  });

  /** Writes a SKILL.md (with the given body) under `<root>/<rel>/<dir>/SKILL.md`. */
  async function writeSkill(root: string, rel: string, dir: string, body: string): Promise<string> {
    const skillDir = path.join(root, rel, dir);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), body, 'utf8');
    return skillDir;
  }

  it('parses front-matter name/description into a repo/claude/Repo skill at the skill dir', async () => {
    const skillDir = await writeSkill(
      repo,
      '.claude/skills',
      'deploy',
      ['---', 'name: Deploy', 'description: Ship the app', '---', '', '# body'].join('\n'),
    );

    const skills = await discoverSkills({ cwd: repo });

    expect(skills).toEqual([
      {
        id: 'Deploy',
        name: 'Deploy',
        description: 'Ship the app',
        path: skillDir,
        source: 'repo',
        provider: 'claude',
        group: 'Repo',
        marketplace: undefined,
      },
    ]);
  });

  it('defaults id and name to the directory name and description to "" when front-matter is empty', async () => {
    const skillDir = await writeSkill(repo, '.claude/skills', 'lint', '# just a body, no front-matter');

    const skills = await discoverSkills({ cwd: repo });

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: 'lint',
      name: 'lint',
      description: '',
      path: skillDir,
      provider: 'claude',
    });
  });

  it('strips single and double quotes from front-matter values', async () => {
    await writeSkill(
      repo,
      '.claude/skills',
      'quoted',
      ['---', 'name: "Quoted Name"', "description: 'single quoted'", '---'].join('\n'),
    );

    const skills = await discoverSkills({ cwd: repo });

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ name: 'Quoted Name', description: 'single quoted' });
  });

  it('skips a skill directory that has no SKILL.md', async () => {
    // Directory exists but contains no SKILL.md → not a skill.
    await fs.mkdir(path.join(repo, '.claude/skills', 'empty'), { recursive: true });
    await writeSkill(repo, '.claude/skills', 'real', ['---', 'name: Real', '---'].join('\n'));

    const skills = await discoverSkills({ cwd: repo });

    expect(skills.map((s) => s.name)).toEqual(['Real']);
  });

  it('dedups the same id under .claude and .agents into one entry with provider "both"', async () => {
    const body = ['---', 'name: shared', 'description: in both conventions', '---'].join('\n');
    await writeSkill(repo, '.claude/skills', 'shared', body);
    await writeSkill(repo, '.agents/skills', 'shared', body);

    const skills = await discoverSkills({ cwd: repo });

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ id: 'shared', name: 'shared', provider: 'both', source: 'repo' });
  });

  it('with HOME at an empty temp dir, returns only repo skills (no worker/plugin roots)', async () => {
    await writeSkill(repo, '.claude/skills', 'only-repo', ['---', 'name: OnlyRepo', '---'].join('\n'));

    const skills = await discoverSkills({ cwd: repo });

    expect(skills).toHaveLength(1);
    expect(skills.every((s) => s.source === 'repo')).toBe(true);
    expect(skills[0]).toMatchObject({ name: 'OnlyRepo', group: 'Repo' });
  });

  it('scans extra repoRoots passed via opts in addition to cwd', async () => {
    const otherRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'conduit-discover-other-'));
    try {
      await writeSkill(repo, '.claude/skills', 'from-cwd', ['---', 'name: FromCwd', '---'].join('\n'));
      await writeSkill(otherRepo, '.claude/skills', 'from-extra', ['---', 'name: FromExtra', '---'].join('\n'));

      const skills = await discoverSkills({ cwd: repo, repoRoots: [otherRepo] });

      expect(skills.map((s) => s.name).sort()).toEqual(['FromCwd', 'FromExtra']);
    } finally {
      await fs.rm(otherRepo, { recursive: true, force: true });
    }
  });

  it('parses front-matter that sits within the first 2KB even when the body is large', async () => {
    const frontMatter = ['---', 'name: Capped', 'description: still parsed', '---', ''].join('\n');
    const body = frontMatter + 'x'.repeat(8192);
    await writeSkill(repo, '.claude/skills', 'capped', body);

    const skills = await discoverSkills({ cwd: repo });

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ name: 'Capped', description: 'still parsed' });
  });
});
