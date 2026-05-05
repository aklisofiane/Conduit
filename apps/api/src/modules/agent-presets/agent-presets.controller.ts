import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../../common/api-key.guard';
import { AgentPresetsService } from './agent-presets.service';

@UseGuards(ApiKeyGuard)
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
