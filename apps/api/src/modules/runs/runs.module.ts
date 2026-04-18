import { Module } from '@nestjs/common';
import { RunsController } from './runs.controller.js';
import { RunsGateway } from './runs.gateway.js';
import { RunsService } from './runs.service.js';

@Module({
  controllers: [RunsController],
  providers: [RunsService, RunsGateway],
})
export class RunsModule {}
