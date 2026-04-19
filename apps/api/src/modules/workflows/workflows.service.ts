import { Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import type { TriggerEvent, WorkflowDefinition } from '@conduit/shared';
import { PrismaService } from '../../common/prisma.service';
import { TemporalService } from '../../temporal/temporal.service';
import type { CreateWorkflowDto, ManualRunDto, UpdateWorkflowDto } from './dto';
import { defaultDefinition } from './defaults';

@Injectable()
export class WorkflowsService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly temporal: TemporalService,
  ) {}

  /**
   * Boot-time reconciliation: make sure every active polling workflow in
   * the DB has a matching Temporal Schedule. Cheap — calls `upsertPollSchedule`
   * which is idempotent. Runs in the background so a Temporal outage at
   * boot doesn't prevent the API from serving. Any failures are logged;
   * they'll retry on the next save or restart.
   */
  async onModuleInit(): Promise<void> {
    void this.reconcilePollSchedules().catch((err: unknown) => {
      this.logger.warn(
        `Poll schedule reconciliation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  private async reconcilePollSchedules(): Promise<void> {
    const workflows = await this.prisma.workflow.findMany();
    for (const wf of workflows) {
      const trigger = (wf.definition as Partial<WorkflowDefinition> | null)?.trigger;
      if (trigger?.mode.kind !== 'polling') continue;
      try {
        await this.temporal.upsertPollSchedule({
          workflowId: wf.id,
          intervalSec: trigger.mode.intervalSec,
          active: wf.isActive && trigger.mode.active,
        });
      } catch (err) {
        this.logger.warn(
          `Reconcile schedule for workflow ${wf.id} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

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
    const wf = await this.prisma.workflow.create({
      data: {
        name: dto.name,
        description: dto.description,
        definition: (dto.definition ?? defaultDefinition()) as unknown as object,
        isActive: false,
      },
    });
    // New workflows default to inactive, so the schedule is created paused
    // (or not at all if the definition is webhook-mode). Still go through
    // sync so a user-seeded definition with a polling trigger registers
    // immediately.
    await this.syncPollSchedule(wf.id, wf.definition, wf.isActive);
    return wf;
  }

  async update(id: string, dto: UpdateWorkflowDto) {
    try {
      const wf = await this.prisma.workflow.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          definition: dto.definition as unknown as object | undefined,
          isActive: dto.isActive,
        },
      });
      await this.syncPollSchedule(wf.id, wf.definition, wf.isActive);
      return wf;
    } catch (err) {
      if (isPrismaNotFound(err)) throw new NotFoundException(`Workflow ${id} not found`);
      throw err;
    }
  }

  async delete(id: string) {
    try {
      await this.prisma.workflow.delete({ where: { id } });
      await this.temporal.deletePollSchedule(id);
    } catch (err) {
      if (isPrismaNotFound(err)) throw new NotFoundException(`Workflow ${id} not found`);
      throw err;
    }
  }

  /**
   * Keep Temporal's Schedule in sync with the workflow's current trigger:
   *
   *   - polling + isActive + mode.active → schedule exists + unpaused
   *   - polling + (inactive anywhere)    → schedule exists + paused
   *   - webhook / manual                 → no schedule (delete if it existed)
   *
   * Schedule failures are logged but never block the workflow write — an
   * inconsistent schedule will be re-reconciled on next save or boot.
   */
  private async syncPollSchedule(
    workflowId: string,
    definition: unknown,
    isActive: boolean,
  ): Promise<void> {
    const trigger = (definition as Partial<WorkflowDefinition> | null)?.trigger;
    try {
      if (trigger?.mode.kind === 'polling') {
        await this.temporal.upsertPollSchedule({
          workflowId,
          intervalSec: trigger.mode.intervalSec,
          active: isActive && trigger.mode.active,
        });
      } else {
        await this.temporal.deletePollSchedule(workflowId);
      }
    } catch (err) {
      this.logger.warn(
        `Sync schedule for workflow ${workflowId} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
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
