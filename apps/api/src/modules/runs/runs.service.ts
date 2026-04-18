import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { TemporalService } from '../../temporal/temporal.service';

export interface LogsQuery {
  nodeName?: string;
  kind?: string;
  limit?: number;
}

@Injectable()
export class RunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly temporal: TemporalService,
  ) {}

  async listForWorkflow(workflowId: string, limit = 50) {
    return this.prisma.workflowRun.findMany({
      where: { workflowId },
      orderBy: { startedAt: 'desc' },
      take: limit,
      include: {
        nodes: { select: { id: true, nodeName: true, status: true, startedAt: true, finishedAt: true } },
      },
    });
  }

  async get(runId: string) {
    const run = await this.prisma.workflowRun.findUnique({
      where: { id: runId },
      include: {
        workflow: { select: { id: true, name: true, definition: true } },
        nodes: true,
      },
    });
    if (!run) throw new NotFoundException(`Run ${runId} not found`);
    return run;
  }

  async cancel(runId: string) {
    const run = await this.get(runId);
    if (!run.temporalWorkflowId) {
      throw new NotFoundException(`Run ${runId} has no Temporal workflow id — already finished?`);
    }
    await this.temporal.cancelAgentWorkflow(run.temporalWorkflowId);
    return this.prisma.workflowRun.update({
      where: { id: runId },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    });
  }

  async logs(runId: string, query: LogsQuery) {
    await this.get(runId);
    const take = Math.min(Math.max(query.limit ?? 500, 1), 5000);
    return this.prisma.executionLog.findMany({
      where: {
        runId,
        nodeName: query.nodeName,
        kind: query.kind as 'TEXT' | 'TOOL_CALL' | 'TOOL_RESULT' | 'USAGE' | 'SYSTEM' | undefined,
      },
      orderBy: { ts: 'asc' },
      take,
    });
  }
}
