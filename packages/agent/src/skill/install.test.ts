import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SkillProviderTag } from '@conduit/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DiscoveredSkill } from './discover';
import { installSkillsIntoWorkspace } from './install';

describe('installSkillsIntoWorkspace', () => {
  let root: string;
  let skillsRoot: string;
  let workspace: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'conduit-install-'));
    skillsRoot = path.join(root, 'src-skills');
    workspace = path.join(root, 'workspace');
    await fs.mkdir(skillsRoot, { recursive: true });
    await fs.mkdir(workspace, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  /**
   * Materialize a skill directory on disk with a SKILL.md plus any extra
   * relative files, then return a DiscoveredSkill pointing at it.
   */
  async function makeSkill(
    id: string,
    provider: SkillProviderTag,
    files: Record<string, string> = {},
  ): Promise<DiscoveredSkill> {
    const dir = path.join(skillsRoot, id);
    const all = { 'SKILL.md': `# ${id}`, ...files };
    for (const [rel, content] of Object.entries(all)) {
      const file = path.join(dir, rel);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, content, 'utf8');
    }
    return {
      id,
      name: id,
      description: '',
      path: dir,
      source: 'worker',
      provider,
      group: 'Worker',
    };
  }

  async function read(rel: string): Promise<string> {
    return fs.readFile(path.join(workspace, rel), 'utf8');
  }

  async function exists(rel: string): Promise<boolean> {
    return fs
      .access(path.join(workspace, rel))
      .then(() => true)
      .catch(() => false);
  }

  it('copies a provider:claude skill into <workspace>/.claude/skills/<id> with files intact', async () => {
    const skill = await makeSkill('formatter', 'claude', { 'SKILL.md': 'claude body' });

    await installSkillsIntoWorkspace(workspace, [skill], 'claude');

    expect(await read('.claude/skills/formatter/SKILL.md')).toBe('claude body');
  });

  it('copies a provider:codex skill into <workspace>/.agents/skills/<id>', async () => {
    const skill = await makeSkill('linter', 'codex', { 'SKILL.md': 'codex body' });

    await installSkillsIntoWorkspace(workspace, [skill], 'codex');

    expect(await read('.agents/skills/linter/SKILL.md')).toBe('codex body');
  });

  it('installs a provider:both skill for the claude provider', async () => {
    const skill = await makeSkill('shared', 'both');

    await installSkillsIntoWorkspace(workspace, [skill], 'claude');

    expect(await exists('.claude/skills/shared/SKILL.md')).toBe(true);
  });

  it('installs a provider:both skill for the codex provider', async () => {
    const skill = await makeSkill('shared', 'both');

    await installSkillsIntoWorkspace(workspace, [skill], 'codex');

    expect(await exists('.agents/skills/shared/SKILL.md')).toBe(true);
  });

  it('does NOT copy a provider:codex skill when installing for claude', async () => {
    const skill = await makeSkill('codex-only', 'codex');

    await installSkillsIntoWorkspace(workspace, [skill], 'claude');

    expect(await exists('.claude/skills/codex-only')).toBe(false);
    expect(await exists('.agents/skills/codex-only')).toBe(false);
  });

  it('installs multiple skills in one call, each under its own <id> dir', async () => {
    const a = await makeSkill('alpha', 'claude');
    const b = await makeSkill('beta', 'both');
    const c = await makeSkill('codex-only', 'codex');

    await installSkillsIntoWorkspace(workspace, [a, b, c], 'claude');

    expect(await exists('.claude/skills/alpha/SKILL.md')).toBe(true);
    expect(await exists('.claude/skills/beta/SKILL.md')).toBe(true);
    expect(await exists('.claude/skills/codex-only')).toBe(false);
  });

  it('copies nested files and subdirectories recursively', async () => {
    const skill = await makeSkill('rich', 'claude', {
      'SKILL.md': 'root',
      'assets/logo.txt': 'logo',
      'assets/nested/deep.txt': 'deep',
    });

    await installSkillsIntoWorkspace(workspace, [skill], 'claude');

    expect(await read('.claude/skills/rich/SKILL.md')).toBe('root');
    expect(await read('.claude/skills/rich/assets/logo.txt')).toBe('logo');
    expect(await read('.claude/skills/rich/assets/nested/deep.txt')).toBe('deep');
  });
});
