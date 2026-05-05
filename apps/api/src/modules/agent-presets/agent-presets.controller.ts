import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../../common/api-key.guard';
import { AgentPresetsService } from './agent-presets.service';

/**
 * Single-agent presets shipped as JSON in `/agent-presets/`. Read-only;
 * loaded once at boot. Surfaced in the canvas's agent config panel as a
 * "Preset" picker that prefills `instructions`, `model`, and `provider`.
 */
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
