import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../../auth/session.guard';
import { AgentPresetsService } from './agent-presets.service';

@UseGuards(SessionGuard)
@Controller()
export class AgentPresetsController {
  constructor(private readonly svc: AgentPresetsService) {}

  @Get('agent-presets')
  list() {
    return this.svc.list();
  }

  @Get('agent-presets/:id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }
}
