import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  WorkflowValidationError,
  assertValidWorkflowDefinition,
  ticketLockFor,
  workflowDefinitionSchema,
  type TriggerEvent,
  type WorkflowDefinition,
} from '@conduit/shared';
import { PrismaService } from '../../common/prisma.service';
import { DuplicateRunError, TemporalService } from '../../temporal/temporal.service';
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
   * Fire-and-forget at boot so a Temporal outage doesn't block API startup;
   * inconsistent schedules recover on next save or restart.
   */
  onModuleInit(): void {
    void this.reconcilePollSchedules();
  }

  private async reconcilePollSchedules(): Promise<void> {
    const workflows = await this.prisma.workflow.findMany();
    const polling = workflows.filter(
      (wf) =>
        (wf.definition as Partial<WorkflowDefinition> | null)?.trigger?.mode.kind === 'polling',
    );
    await Promise.allSettled(
      polling.map((wf) => this.syncPollSchedule(wf.id, wf.definition, wf.isActive)),
    );
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
    const definition = dto.definition ?? defaultDefinition();
    assertDefinitionValid(definition);
    const wf = await this.prisma.workflow.create({
      data: {
        name: dto.name,
        description: dto.description,
        definition: definition as unknown as object,
        isActive: false,
      },
    });
    await this.syncPollSchedule(wf.id, wf.definition, wf.isActive);
    return wf;
  }

  async update(id: string, dto: UpdateWorkflowDto) {
    if (dto.definition) assertDefinitionValid(dto.definition);
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
        `Sync schedule for workflow ${workflowId} failed: ${errMessage(err)}`,
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
   *
   * For `ticket-branch` workflows: the Temporal start uses a deterministic
   * ID keyed on `(workflowId, ticketKey)`. A duplicate trigger arriving
   * while a run is in flight surfaces as `DuplicateRunError` — we delete
   * the placeholder row and return `null`. Callers propagate that as a
   * soft-drop (HTTP 200 `status: 'duplicate-dropped'` on the webhook path).
   */
  async startRun(workflowId: string, triggerEvent: TriggerEvent) {
    const wf = await this.get(workflowId);
    const definition = workflowDefinitionSchema.safeParse(wf.definition);
    const ticketLock = definition.success
      ? ticketLockFor(definition.data, workflowId, triggerEvent)
      : undefined;

    const run = await this.prisma.workflowRun.create({
      data: {
        workflowId,
        status: 'PENDING',
        trigger: triggerEvent as unknown as object,
      },
    });
    try {
      const { temporalWorkflowId, temporalRunId } = await this.temporal.startAgentWorkflow(
        { workflowId, runId: run.id, triggerEvent },
        { ticketLock },
      );
      return this.prisma.workflowRun.update({
        where: { id: run.id },
        data: { status: 'RUNNING', temporalWorkflowId, temporalRunId },
      });
    } catch (err) {
      if (err instanceof DuplicateRunError) {
        // ticket-branch collapse: swallow the duplicate and remove the row
        // we just created so the run history doesn't fill with phantoms.
        await this.prisma.workflowRun.delete({ where: { id: run.id } }).catch(() => undefined);
        this.logger.debug(
          `Duplicate ticket-branch trigger for workflow ${workflowId} (${err.temporalWorkflowId}) — dropped`,
        );
        return null;
      }
      await this.prisma.workflowRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', error: String(err), finishedAt: new Date() },
      });
      throw err;
    }
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Run semantic validation (ticket-branch trigger compatibility, etc.) and
 * re-throw as a 400 so the UI gets a useful error body instead of a 500.
 */
function assertDefinitionValid(definition: WorkflowDefinition): void {
  try {
    assertValidWorkflowDefinition(definition);
  } catch (err) {
    if (err instanceof WorkflowValidationError) {
      throw new BadRequestException({
        message: err.message,
        issues: err.issues,
      });
    }
    throw err;
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
