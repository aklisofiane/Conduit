import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { executionLogKindSchema, type ExecutionLogKind } from '@conduit/shared';
import { OrgId } from '../../auth/org-id.decorator';
import { SessionGuard } from '../../auth/session.guard';
import { RunsService } from './runs.service';

@UseGuards(SessionGuard)
@Controller()
export class RunsController {
  constructor(private readonly svc: RunsService) {}

  @Get('workflows/:workflowId/runs')
  listForWorkflow(
    @OrgId() orgId: string,
    @Param('workflowId') workflowId: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.listForWorkflow(orgId, workflowId, parseLimit(limit));
  }

  @Get('runs/:runId')
  get(@OrgId() orgId: string, @Param('runId') runId: string) {
    return this.svc.get(orgId, runId);
  }

  @Post('runs/:runId/cancel')
  cancel(@OrgId() orgId: string, @Param('runId') runId: string) {
    return this.svc.cancel(orgId, runId);
  }

  @Get('runs/:runId/logs')
  logs(
    @OrgId() orgId: string,
    @Param('runId') runId: string,
    @Query('nodeName') nodeName?: string,
    @Query('kind') kind?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.logs(orgId, runId, {
      nodeName,
      kind: parseKind(kind),
      limit: parseLimit(limit),
    });
  }

  @Get('runs/:runId/logs/:nodeName')
  logsForNode(
    @OrgId() orgId: string,
    @Param('runId') runId: string,
    @Param('nodeName') nodeName: string,
    @Query('kind') kind?: string,
    @Query('limit') limit?: string,
  ) {
    return this.logs(orgId, runId, nodeName, kind, limit);
  }
}

function parseLimit(s?: string): number | undefined {
  return s ? Number.parseInt(s, 10) : undefined;
}

function parseKind(s?: string): ExecutionLogKind | undefined {
  if (!s) return undefined;
  const r = executionLogKindSchema.safeParse(s);
  return r.success ? r.data : undefined;
}
