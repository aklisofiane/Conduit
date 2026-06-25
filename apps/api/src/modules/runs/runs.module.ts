import { Module } from '@nestjs/common';
import { WorkflowsModule } from '../workflows/workflows.module';
import { RunsController } from './runs.controller';
import { RunsGateway } from './runs.gateway';
import { RunsService } from './runs.service';

@Module({
  imports: [WorkflowsModule],
  controllers: [RunsController],
  providers: [RunsService, RunsGateway],
})
export class RunsModule {}
