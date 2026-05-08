import {
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  ticketLockFor,
  workflowDefinitionSchema,
  type TriggerEvent,
  type WorkflowDefinition,
} from '@conduit/shared';
import { PrismaService } from '../../common/prisma.service';
import { assertDefinitionValid } from '../../common/assert-definition-valid';
import { DuplicateRunError, TemporalService } from '../../temporal/temporal.service';
import type { CreateWorkflowDto, UpdateWorkflowDto } from './dto';
import { defaultDefinition } from './defaults';
import { remapConnectionIds } from './remap-connection-ids';

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
    const polling = workflows.filter((wf) => {
      const trigger = (wf.definition as Partial<WorkflowDefinition> | null)
        ?.triggers?.[0];
      return trigger?.mode.kind === 'polling';
    });
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
        _count: { select: { runs: true } },
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
      if (dto.isActive !== undefined || dto.definition !== undefined) {
        await this.syncPollSchedule(wf.id, wf.definition, wf.isActive);
      }
      return wf;
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
    // Schedule cleanup is best-effort: the row is gone, so a leaked schedule
    // would fire against a missing workflow and self-recover at next reconcile.
    // Don't promote a Temporal error to a 500 after the DB delete succeeded.
    try {
      await this.temporal.deletePollSchedule(id);
    } catch (err) {
      this.logger.warn(
        `Deleting poll schedule for workflow ${id} failed: ${errMessage(err)}`,
      );
    }
  }

  /**
   * Clone a workflow + its `WorkflowConnection` rows in a single transaction,
   * rewriting every `connectionId` reference inside the cloned `definition`
   * to point at the new connection ids. The duplicate starts paused
   * (`isActive: false`) so it doesn't trigger until the user reviews it.
   *
   * Webhook signing secrets are copied byte-for-byte — the AES-GCM ciphertext
   * is workflow-agnostic, so the duplicate shares the source's secret. That's
   * acceptable: webhook URLs are per-workflow (`/hooks/:workflowId`), so the
   * duplicate gets its own URL while reusing the same secret value.
   */
  async duplicate(id: string) {
    const source = await this.prisma.workflow.findUnique({
      where: { id },
      include: { connections: true },
    });
    if (!source) throw new NotFoundException(`Workflow ${id} not found`);

    const created = await this.prisma.$transaction(async (tx) => {
      const stub = await tx.workflow.create({
        data: {
          name: `${source.name} (copy)`,
          description: source.description,
          definition: {} as unknown as object,
          isActive: false,
        },
      });

      const idMap: Record<string, string> = {};
      for (const conn of source.connections) {
        const cloned = await tx.workflowConnection.create({
          data: {
            workflowId: stub.id,
            alias: conn.alias,
            credentialId: conn.credentialId,
            owner: conn.owner,
            repo: conn.repo,
            webhookSecret: conn.webhookSecret,
          },
        });
        idMap[conn.id] = cloned.id;
      }

      const definition = remapConnectionIds(source.definition, idMap);
      return tx.workflow.update({
        where: { id: stub.id },
        data: { definition: definition as unknown as object },
      });
    });

    await this.syncPollSchedule(created.id, created.definition, created.isActive);
    return created;
  }

  /**
   * Keep Temporal's Schedule in sync with the workflow's current trigger:
   *
   *   - polling + isActive    → schedule exists + unpaused
   *   - polling + !isActive   → schedule exists + paused
   *   - webhook               → no schedule (delete if it existed)
   *
   * Schedule failures are logged but never block the workflow write — an
   * inconsistent schedule will be re-reconciled on next save or boot.
   */
  private async syncPollSchedule(
    workflowId: string,
    definition: unknown,
    isActive: boolean,
  ): Promise<void> {
    const trigger = (definition as Partial<WorkflowDefinition> | null)?.triggers?.[0];
    try {
      if (trigger?.mode.kind === 'polling') {
        await this.temporal.upsertPollSchedule({
          workflowId,
          intervalSec: trigger.mode.intervalSec,
          active: isActive,
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
   * Creates the `WorkflowRun` row, starts the Temporal workflow, flips the
   * row to `RUNNING` on success or `FAILED` on start failure. Callers handle
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

function isPrismaNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'P2025'
  );
}
