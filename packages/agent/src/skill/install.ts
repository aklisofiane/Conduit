import fs from 'node:fs/promises';
import path from 'node:path';
import type { DiscoveredSkill } from './discover';

const DEST_BY_PROVIDER: Record<'claude' | 'codex', string> = {
  claude: '.claude/skills',
  codex: '.agents/skills',
};

/**
 * Copy selected skill directories into the agent workspace before the
 * provider spins up. Both Claude and Codex SDKs auto-discover from their
 * conventional directories — Conduit just places the files there.
 */
export async function installSkillsIntoWorkspace(
  workspacePath: string,
  skills: DiscoveredSkill[],
  providerId: 'claude' | 'codex',
): Promise<void> {
  const dest = path.join(workspacePath, DEST_BY_PROVIDER[providerId]);
  const compatible = skills.filter(
    (s) => s.provider === 'both' || s.provider === providerId,
  );
  await Promise.all(
    compatible.map((skill) => copyDir(skill.path, path.join(dest, skill.id))),
  );
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await copyDir(srcPath, destPath);
      } else if (entry.isFile()) {
        await fs.copyFile(srcPath, destPath);
      }
    }),
  );
}
