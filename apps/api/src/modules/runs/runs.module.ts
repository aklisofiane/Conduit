import { Module } from '@nestjs/common';
import { RunsController } from './runs.controller';
import { RunsGateway } from './runs.gateway';
import { RunsService } from './runs.service';

@Module({
  controllers: [RunsController],
  providers: [RunsService, RunsGateway],
})
export class RunsModule {}
