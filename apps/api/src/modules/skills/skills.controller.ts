import { Controller, Get, UseGuards } from '@nestjs/common';
import { discoverSkills } from '@conduit/agent';
import { ApiKeyGuard } from '../../common/api-key.guard.js';

@UseGuards(ApiKeyGuard)
@Controller('skills')
export class SkillsController {
  /**
   * Scans repo + worker locations for `SKILL.md` files. See
   * docs/design-docs/node-system.md — "Skills". The UI calls this to
   * populate the agent config panel's skill picker.
   */
  @Get()
  async list() {
    return discoverSkills();
  }
}
