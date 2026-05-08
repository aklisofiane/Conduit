import { Controller, Get, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../../auth/session.guard';
import { SkillsService } from './skills.service';

@UseGuards(SessionGuard)
@Controller('skills')
export class SkillsController {
  constructor(private readonly svc: SkillsService) {}

  /**
   * Returns the boot-time skill scan. See docs/design-docs/node-system.md
   * — "Skills". The UI calls this to populate the agent config panel's
   * skill picker.
   */
  @Get()
  list() {
    return this.svc.list();
  }
}
