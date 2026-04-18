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
  for (const skill of skills) {
    if (skill.provider !== 'both' && skill.provider !== providerId) continue;
    const target = path.join(dest, skill.id);
    await fs.mkdir(target, { recursive: true });
    await copyDir(skill.path, target);
  }
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}
