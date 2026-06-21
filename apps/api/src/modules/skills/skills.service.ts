import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { discoverSkills, type DiscoveredSkill } from '@conduit/agent';

/** Re-scan at most this often; bounds the cost of a directory walk per request. */
const SCAN_TTL_MS = 5_000;

/**
 * Serves the result of `discoverSkills`. The scan walks `~/.claude/skills` +
 * `<cwd>/.claude/skills` (and the codex variants) plus the `skills/` dir of
 * every enabled Claude Code plugin.
 *
 * Result is cached for {@link SCAN_TTL_MS} rather than only at boot, so
 * toggling a plugin or dropping in a new `SKILL.md` surfaces on the next
 * refetch (e.g. reopening the agent config panel) without an API restart —
 * while a burst of `GET /skills` calls still shares one walk.
 */
@Injectable()
export class SkillsService implements OnModuleInit {
  private readonly logger = new Logger(SkillsService.name);
  private cache: { at: number; skills: DiscoveredSkill[] } | null = null;
  private inFlight: Promise<DiscoveredSkill[]> | null = null;

  async onModuleInit(): Promise<void> {
    const skills = await this.list();
    this.logger.log(`Discovered ${skills.length} skill(s)`);
  }

  async list(): Promise<DiscoveredSkill[]> {
    if (this.cache && Date.now() - this.cache.at < SCAN_TTL_MS) return this.cache.skills;
    // Collapse concurrent expirations onto a single in-flight scan.
    this.inFlight ??= this.scan();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async scan(): Promise<DiscoveredSkill[]> {
    const skills = await discoverSkills();
    this.cache = { at: Date.now(), skills };
    return skills;
  }
}
