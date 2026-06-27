import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentProviderId } from '@conduit/shared';

/**
 * Provider → conventional skills directory inside the agent workspace. Mirrors
 * `DEST_BY_PROVIDER` in `install.ts`: both Claude and Codex SDKs auto-discover
 * skills from these dirs, so Conduit just places the files there.
 */
const DEST_BY_PROVIDER: Record<AgentProviderId, string> = {
  claude: '.claude/skills',
  codex: '.agents/skills',
};

/**
 * The three internal-only skills that guide the repo-analyzer **Design** agent
 * when it authors `WorkflowDraft` prose. They live in the agent package source
 * at `src/analysis/skills/<id>/SKILL.md` and are staged directly into the
 * analysis worktree — they are deliberately **never** walked by `discoverSkills`
 * (which only scans `~/.claude/skills`, plugin roots, and repo/cwd roots), so
 * they never surface in `GET /skills` or the canvas skill picker.
 */
const ANALYSIS_SKILL_IDS = ['draft-format', 'scope-authoring', 'reviewer-authoring'] as const;

/**
 * Resolve the bundled `analysis/skills` directory at runtime.
 *
 * Asset-resolution gotcha: the agent package builds with `tsc --build`, which
 * compiles `.ts` → `.js` but does **not** copy the skills' `.md` files into
 * `dist/`. So we cannot resolve the bundle relative to `__dirname` of the
 * compiled `dist/skill/*.js` module — the `.md` files simply aren't there.
 *
 * What *is* always shipped (and present in dev) is the package's `src` tree
 * (`package.json#files` lists `src`). So we resolve the package root by walking
 * up from this module's directory until we find the `package.json`, then point
 * at `<root>/src/analysis/skills`. This works whether the running module lives
 * under `src/` (vitest / tsx) or `dist/` (built worker) — in both cases walking
 * up lands on the same package root, and we always read from `src`.
 */
async function resolveAnalysisSkillsDir(): Promise<string> {
  let dir = __dirname;
  // Walk up until a package.json is found (the agent package root). Bounded by
  // the filesystem root.
  for (;;) {
    const candidate = path.join(dir, 'package.json');
    try {
      await fs.access(candidate);
      return path.join(dir, 'src', 'analysis', 'skills');
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) {
        throw new Error('could not locate @conduit/agent package root for analysis skills');
      }
      dir = parent;
    }
  }
}

/**
 * Stage the bundled repo-analyzer Design skills into an analysis worktree so the
 * Design agent can consult them. Copies each of the three internal skill
 * subdirs into `<workspace>/.claude/skills/<id>` (claude) or
 * `<workspace>/.agents/skills/<id>` (codex), matching the SDK auto-discovery
 * convention used by `installSkillsIntoWorkspace`.
 *
 * Unlike `installSkillsIntoWorkspace`, this does not go through `discoverSkills`
 * — the source bundle is internal package source that `discoverSkills` never
 * scans, so these skills never appear in `GET /skills`.
 */
export async function installAnalysisSkillsIntoWorkspace(
  workspacePath: string,
  providerId: AgentProviderId,
): Promise<void> {
  const srcDir = await resolveAnalysisSkillsDir();
  const dest = path.join(workspacePath, DEST_BY_PROVIDER[providerId]);
  await Promise.all(
    ANALYSIS_SKILL_IDS.map((id) =>
      fs.cp(path.join(srcDir, id), path.join(dest, id), { recursive: true }),
    ),
  );
}
