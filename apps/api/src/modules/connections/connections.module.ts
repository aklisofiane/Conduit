import { Module } from '@nestjs/common';
import { AgentPresetsModule } from '../agent-presets/agent-presets.module';
import { ConnectionAnalysisService } from './connection-analysis.service';
import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';

@Module({
  imports: [AgentPresetsModule],
  controllers: [ConnectionsController],
  providers: [ConnectionsService, ConnectionAnalysisService],
  exports: [ConnectionsService],
})
export class ConnectionsModule {}
