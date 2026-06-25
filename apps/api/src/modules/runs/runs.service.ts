import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ExecutionLogKind, TriggerEvent } from '@conduit/shared';
import { PrismaService } from '../../common/prisma.service';
import { orNotFound } from '../../common/or-not-found';
import { TemporalService } from '../../temporal/temporal.service';
import { WorkflowsService } from '../workflows/workflows.service';

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
    private readonly workflows: WorkflowsService,
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
    return orNotFound(run, 'Run', runId);
  }

  async cancel(orgId: string, runId: string) {
    const run = orNotFound(
      await this.prisma.workflowRun.findFirst({
        where: { id: runId, orgId },
        select: { id: true, temporalWorkflowId: true },
      }),
      'Run',
      runId,
    );
    if (!run.temporalWorkflowId) {
      throw new NotFoundException(`Run ${runId} has no Temporal workflow id — already finished?`);
    }
    await this.temporal.cancelAgentWorkflow(run.temporalWorkflowId);
    return this.prisma.workflowRun.update({
      where: { id: runId },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    });
  }

  /**
   * Re-execute a FAILED run with its original input. The complete
   * `TriggerEvent` is persisted on the run, so we replay it through the same
   * `startRun` path webhooks/polling/cron use — producing a brand-new run and
   * Temporal execution, loading the current workflow definition fresh.
   *
   * Returns the new run, or `null` when `startRun` soft-drops a ticket-branch
   * duplicate (a newer run for the same ticket is already in flight).
   */
  async rerun(orgId: string, runId: string) {
    const run = orNotFound(
      await this.prisma.workflowRun.findFirst({
        where: { id: runId, orgId },
        select: { status: true, workflowId: true, trigger: true },
      }),
      'Run',
      runId,
    );
    if (run.status !== 'FAILED') {
      throw new ConflictException(`Only failed runs can be rerun (run ${runId} is ${run.status})`);
    }
    const triggerEvent = run.trigger as unknown as TriggerEvent;
    return this.workflows.startRun(orgId, run.workflowId, triggerEvent);
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
