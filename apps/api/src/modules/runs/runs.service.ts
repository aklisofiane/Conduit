import { Injectable, NotFoundException } from '@nestjs/common';
import type { ExecutionLogKind } from '@conduit/shared';
import { PrismaService } from '../../common/prisma.service';
import { TemporalService } from '../../temporal/temporal.service';

export interface LogsQuery {
  nodeName?: string;
  kind?: ExecutionLogKind;
  limit?: number;
}

@Injectable()
export class RunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly temporal: TemporalService,
  ) {}

  async listForWorkflow(orgId: string, workflowId: string, limit = 50) {
    return this.prisma.workflowRun.findMany({
      where: { workflowId, orgId },
      orderBy: { startedAt: 'desc' },
      take: limit,
      include: {
        nodes: { select: { id: true, nodeName: true, status: true, startedAt: true, finishedAt: true } },
      },
    });
  }

  async get(orgId: string, runId: string) {
    const run = await this.prisma.workflowRun.findFirst({
      where: { id: runId, orgId },
      include: {
        workflow: { select: { id: true, name: true, definition: true } },
        nodes: true,
      },
    });
    if (!run) throw new NotFoundException(`Run ${runId} not found`);
    return run;
  }

  async cancel(orgId: string, runId: string) {
    const run = await this.prisma.workflowRun.findFirst({
      where: { id: runId, orgId },
      select: { id: true, temporalWorkflowId: true },
    });
    if (!run) throw new NotFoundException(`Run ${runId} not found`);
    if (!run.temporalWorkflowId) {
      throw new NotFoundException(`Run ${runId} has no Temporal workflow id — already finished?`);
    }
    await this.temporal.cancelAgentWorkflow(run.temporalWorkflowId);
    return this.prisma.workflowRun.update({
      where: { id: runId },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    });
  }

  async logs(orgId: string, runId: string, query: LogsQuery) {
    const take = Math.min(Math.max(query.limit ?? 500, 1), 5000);
    return this.prisma.executionLog.findMany({
      where: {
        runId,
        orgId,
        nodeName: query.nodeName,
        kind: query.kind,
      },
      orderBy: { ts: 'asc' },
      take,
    });
  }
}
