import { Module } from '@nestjs/common';

import { TemporalModule } from '../../temporal/temporal.module';
import { AgentPresetsModule } from '../agent-presets/agent-presets.module';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  imports: [TemporalModule, AgentPresetsModule],
  controllers: [TemplatesController],
  providers: [TemplatesService],
})
export class TemplatesModule {}
