import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverSkills } from './discover';
import { installAnalysisSkillsIntoWorkspace } from './analysis-skills';

const ANALYSIS_SKILL_IDS = ['draft-format', 'scope-authoring', 'reviewer-authoring'] as const;

/** Walk up from this test module to the @conduit/agent package root. */
function agentPackageRoot(): string {
  // .../packages/agent/src/skill/analysis-skills.test.ts → .../packages/agent
  return path.resolve(__dirname, '..', '..');
}

describe('installAnalysisSkillsIntoWorkspace', () => {
  let root: string;
  let workspace: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'conduit-analysis-skills-'));
    workspace = path.join(root, 'workspace');
    await fs.mkdir(workspace, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function exists(rel: string): Promise<boolean> {
    return fs
      .access(path.join(workspace, rel))
      .then(() => true)
      .catch(() => false);
  }

  it('stages all three analysis skills (each with SKILL.md) into <workspace>/.claude/skills for claude', async () => {
    await installAnalysisSkillsIntoWorkspace(workspace, 'claude');

    for (const id of ANALYSIS_SKILL_IDS) {
      expect(await exists(`.claude/skills/${id}/SKILL.md`)).toBe(true);
    }
  });

  it('stages all three analysis skills into <workspace>/.agents/skills for codex', async () => {
    await installAnalysisSkillsIntoWorkspace(workspace, 'codex');

    for (const id of ANALYSIS_SKILL_IDS) {
      expect(await exists(`.agents/skills/${id}/SKILL.md`)).toBe(true);
    }
  });

  it('copies non-trivial SKILL.md bodies, not empty placeholders', async () => {
    await installAnalysisSkillsIntoWorkspace(workspace, 'claude');

    const body = await fs.readFile(
      path.join(workspace, '.claude/skills/draft-format/SKILL.md'),
      'utf8',
    );
    // Front-matter + the load-bearing charset rule survive the copy.
    expect(body).toContain('name: draft-format');
    expect(body).toContain('/^[A-Za-z_][A-Za-z0-9_]*$/');
  });
});

describe('analysis skills are invisible to discoverSkills (GET /skills data source)', () => {
  it('does NOT enumerate the three analysis skills, even with cwd at the agent package root', async () => {
    // The bundle lives at `src/analysis/skills`, which is NOT one of
    // discoverSkills' roots (`.claude/skills` / `.agents/skills`). Pointing cwd
    // at the package root that *contains* the bundle proves the dir is never
    // walked: the analysis skills must still be absent from the result.
    const discovered = await discoverSkills({ cwd: agentPackageRoot() });
    const ids = new Set(discovered.map((s) => s.id));
    const names = new Set(discovered.map((s) => s.name));
    for (const id of ANALYSIS_SKILL_IDS) {
      expect(ids.has(id)).toBe(false);
      expect(names.has(id)).toBe(false);
    }
  });

  it('does NOT enumerate the analysis skills after they are staged into a workspace, when discovering elsewhere', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'conduit-analysis-discover-'));
    try {
      const staged = path.join(tmp, 'staged-workspace');
      const otherCwd = path.join(tmp, 'other-cwd');
      await fs.mkdir(staged, { recursive: true });
      await fs.mkdir(otherCwd, { recursive: true });

      await installAnalysisSkillsIntoWorkspace(staged, 'claude');

      // Discovering from an unrelated cwd never reaches the staged worktree.
      const discovered = await discoverSkills({ cwd: otherCwd });
      const ids = new Set(discovered.map((s) => s.id));
      for (const id of ANALYSIS_SKILL_IDS) {
        expect(ids.has(id)).toBe(false);
      }
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
