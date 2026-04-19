import { Injectable, NotFoundException } from '@nestjs/common';
import type { TriggerEvent, WorkflowDefinition } from '@conduit/shared';
import { PrismaService } from '../../common/prisma.service';
import { TemporalService } from '../../temporal/temporal.service';
import type { CreateWorkflowDto, ManualRunDto, UpdateWorkflowDto } from './dto';
import { defaultDefinition } from './defaults';

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly temporal: TemporalService,
  ) {}

  async list() {
    return this.prisma.workflow.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        runs: {
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            startedAt: true,
            finishedAt: true,
            error: true,
          },
        },
      },
    });
  }

  async get(id: string) {
    const wf = await this.prisma.workflow.findUnique({ where: { id } });
    if (!wf) throw new NotFoundException(`Workflow ${id} not found`);
    return wf;
  }

  async create(dto: CreateWorkflowDto) {
    return this.prisma.workflow.create({
      data: {
        name: dto.name,
        description: dto.description,
        definition: (dto.definition ?? defaultDefinition()) as unknown as object,
        isActive: false,
      },
    });
  }

  async update(id: string, dto: UpdateWorkflowDto) {
    try {
      return await this.prisma.workflow.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          definition: dto.definition as unknown as object | undefined,
          isActive: dto.isActive,
        },
      });
    } catch (err) {
      if (isPrismaNotFound(err)) throw new NotFoundException(`Workflow ${id} not found`);
      throw err;
    }
  }

  async delete(id: string) {
    try {
      await this.prisma.workflow.delete({ where: { id } });
    } catch (err) {
      if (isPrismaNotFound(err)) throw new NotFoundException(`Workflow ${id} not found`);
      throw err;
    }
  }

  /**
   * Start a manual run. Creates a WorkflowRun row, then kicks off the
   * Temporal workflow; updates the row with temporal IDs once accepted.
   * Returns the created row so the UI can navigate to `/runs/:id`.
   */
  async manualRun(id: string, dto: ManualRunDto) {
    const wf = await this.get(id);
    const triggerEvent = buildManualTriggerEvent(wf.definition, dto);
    return this.startRun(id, triggerEvent);
  }

  /**
   * Shared by manual runs and inbound webhook deliveries. Creates the
   * `WorkflowRun` row, starts the Temporal workflow, flips the row to
   * `RUNNING` on success or `FAILED` on start failure. Callers handle
   * trigger-matching / auth before invoking this.
   */
  async startRun(workflowId: string, triggerEvent: TriggerEvent) {
    const run = await this.prisma.workflowRun.create({
      data: {
        workflowId,
        status: 'PENDING',
        trigger: triggerEvent as unknown as object,
      },
    });
    try {
      const { temporalWorkflowId, temporalRunId } = await this.temporal.startAgentWorkflow({
        workflowId,
        runId: run.id,
        triggerEvent,
      });
      return this.prisma.workflowRun.update({
        where: { id: run.id },
        data: { status: 'RUNNING', temporalWorkflowId, temporalRunId },
      });
    } catch (err) {
      await this.prisma.workflowRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', error: String(err), finishedAt: new Date() },
      });
      throw err;
    }
  }
}

function isPrismaNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'P2025'
  );
}

function buildManualTriggerEvent(
  definition: unknown,
  dto: ManualRunDto,
): TriggerEvent {
  const def = definition as Partial<WorkflowDefinition> | null;
  const source = def?.trigger?.platform ?? 'github';
  return {
    source,
    mode: 'manual',
    event: 'manual.run',
    payload: {},
    repo: dto.repo,
    issue: dto.issue,
    actor: dto.actor ?? 'manual',
  };
}
