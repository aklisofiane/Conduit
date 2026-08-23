import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentProviderId } from '@conduit/shared';
import type { DiscoveredSkill } from './discover';

/**
 * Provider → conventional skills directory inside the agent workspace. Both the
 * Claude and Codex SDKs auto-discover skills from these dirs, so Conduit just
 * places the files there. Shared with `installAnalysisSkillsIntoWorkspace`.
 */
export const DEST_BY_PROVIDER: Record<AgentProviderId, string> = {
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
  providerId: AgentProviderId,
): Promise<void> {
  const dest = path.join(workspacePath, DEST_BY_PROVIDER[providerId]);
  const compatible = skills.filter((s) => s.provider === 'both' || s.provider === providerId);
  await Promise.all(
    compatible.map((skill) => fs.cp(skill.path, path.join(dest, skill.id), { recursive: true })),
  );
}
