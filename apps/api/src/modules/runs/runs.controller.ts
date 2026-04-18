import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../../common/api-key.guard.js';
import { RunsService } from './runs.service.js';

@UseGuards(ApiKeyGuard)
@Controller()
export class RunsController {
  constructor(private readonly svc: RunsService) {}

  @Get('workflows/:workflowId/runs')
  listForWorkflow(
    @Param('workflowId') workflowId: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.listForWorkflow(workflowId, limit ? Number.parseInt(limit, 10) : undefined);
  }

  @Get('runs/:runId')
  get(@Param('runId') runId: string) {
    return this.svc.get(runId);
  }

  @Post('runs/:runId/cancel')
  cancel(@Param('runId') runId: string) {
    return this.svc.cancel(runId);
  }

  @Get('runs/:runId/logs')
  logs(
    @Param('runId') runId: string,
    @Query('nodeName') nodeName?: string,
    @Query('kind') kind?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.logs(runId, {
      nodeName,
      kind,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
    });
  }

  @Get('runs/:runId/logs/:nodeName')
  logsForNode(
    @Param('runId') runId: string,
    @Param('nodeName') nodeName: string,
    @Query('kind') kind?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.logs(runId, {
      nodeName,
      kind,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
    });
  }
}
