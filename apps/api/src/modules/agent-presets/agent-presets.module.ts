import { Module } from '@nestjs/common';

import { AgentPresetsController } from './agent-presets.controller';
import { AgentPresetsService } from './agent-presets.service';

@Module({
  controllers: [AgentPresetsController],
  providers: [AgentPresetsService],
  exports: [AgentPresetsService],
})
export class AgentPresetsModule {}
