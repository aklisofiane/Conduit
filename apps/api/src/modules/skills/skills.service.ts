import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { discoverSkills, type DiscoveredSkill } from '@conduit/agent';

/**
 * Caches the result of `discoverSkills` at boot. The scan walks
 * `~/.claude/skills` + `<cwd>/.claude/skills` (and the codex variants), so
 * doing it on every `GET /skills` would mean a directory walk per UI render.
 * New skills require a restart to surface — same convention as templates
 * and agent presets.
 */
@Injectable()
export class SkillsService implements OnModuleInit {
  private readonly logger = new Logger(SkillsService.name);
  private skills: DiscoveredSkill[] = [];

  async onModuleInit(): Promise<void> {
    this.skills = await discoverSkills();
    this.logger.log(`Discovered ${this.skills.length} skill(s)`);
  }

  list(): DiscoveredSkill[] {
    return this.skills;
  }
}
