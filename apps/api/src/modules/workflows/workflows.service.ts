import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  isScheduledTrigger,
  ticketLockFor,
  workflowDefinitionSchema,
  type TriggerEvent,
  type WorkflowDefinition,
} from '@conduit/shared';
import { PrismaService } from '../../common/prisma.service';
import { orNotFound } from '../../common/or-not-found';
import { assertDefinitionValid } from '../../common/assert-definition-valid';
import { errMessage } from '../../common/err-message';
import {
  DuplicateRunError,
  TemporalService,
  scheduleOptionsForTrigger,
} from '../../temporal/temporal.service';
import { resolveTemporalSlug } from '../../temporal/temporal-slug';
import { encrypt } from '../credentials/crypto';
import type { CreateWorkflowDto, UpdateWorkflowDto } from './dto';
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
    void this.reconcileWorkflowSchedules();
  }

  private async reconcileWorkflowSchedules(): Promise<void> {
    const workflows = await this.prisma.workflow.findMany({
      select: {
        id: true,
        name: true,
        definition: true,
        isActive: true,
        temporalSlug: true,
      },
    });
    const scheduled = workflows.filter((wf) =>
      isScheduledTrigger((wf.definition as Partial<WorkflowDefinition> | null)?.triggers?.[0]),
    );
    await Promise.allSettled(scheduled.map((wf) => this.syncWorkflowSchedule(wf)));
  }

  async list(orgId: string) {
    return this.prisma.workflow.findMany({
      // SYSTEM workflows (hidden per-org host for internal analysis runs) never
      // surface to the user.
      where: { orgId, kind: 'STANDARD' },
      // Alphabetical by name so the list stays stable — toggling active/inactive
      // (which bumps updatedAt) must not reorder the page under the user.
      orderBy: { name: 'asc' },
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

  async get(orgId: string, id: string) {
    // SYSTEM workflows are not user-addressable — 404 a guessed id.
    const wf = await this.prisma.workflow.findFirst({ where: { id, orgId, kind: 'STANDARD' } });
    return orNotFound(wf, 'Workflow', id);
  }

  async create(orgId: string, dto: CreateWorkflowDto) {
    const definition = dto.definition ?? defaultDefinition(dto.triggerType);
    assertDefinitionValid(definition);
    const wf = await this.prisma.workflow.create({
      data: {
        orgId,
        name: dto.name,
        description: dto.description,
        definition: definition as unknown as object,
        isActive: false,
      },
    });
    await this.syncWorkflowSchedule(wf);
    return wf;
  }

  async update(orgId: string, id: string, dto: UpdateWorkflowDto) {
    if (dto.definition) assertDefinitionValid(dto.definition);

    // Gate activation before the DB write so the user gets a clean 400 with
    // a precise message rather than a downstream schedule error. We have to
    // peek at the *resulting* definition: the DTO may carry one, otherwise
    // fall back to what's already stored.
    if (dto.isActive === true) {
      const existing = orNotFound(
        await this.prisma.workflow.findFirst({
          where: { id, orgId, kind: 'STANDARD' },
          select: { definition: true },
        }),
        'Workflow',
        id,
      );
      const effective =
        (dto.definition as WorkflowDefinition | undefined) ??
        (existing.definition as WorkflowDefinition);
      this.assertActivatable(effective);
    }

    // updateMany returns count rather than throwing on miss — gives us the
    // 404-on-cross-org shape the spec requires (no 403 leak).
    const result = await this.prisma.workflow.updateMany({
      where: { id, orgId, kind: 'STANDARD' },
      data: {
        name: dto.name,
        description: dto.description,
        definition: dto.definition as unknown as object | undefined,
        isActive: dto.isActive,
      },
    });
    if (result.count === 0) {
      throw new NotFoundException(`Workflow ${id} not found`);
    }
    const wf = await this.prisma.workflow.findUniqueOrThrow({ where: { id } });
    if (dto.isActive !== undefined || dto.definition !== undefined) {
      await this.syncWorkflowSchedule(wf);
    }
    return wf;
  }

  /**
   * Activation requires exactly one trigger. The Zod schema allows zero
   * (legal in-flight while the user is swapping kinds by delete-then-add),
   * so the gate lives here — at the API boundary — to produce a clearer
   * error than a schema mismatch on save.
   */
  private assertActivatable(definition: WorkflowDefinition | undefined | null): void {
    const triggerCount = definition?.triggers?.length ?? 0;
    if (triggerCount !== 1) {
      throw new BadRequestException(
        triggerCount === 0
          ? 'Cannot activate a workflow with no trigger — add one from the palette first.'
          : `Cannot activate a workflow with ${triggerCount} triggers — only one is allowed.`,
      );
    }
  }

  async delete(orgId: string, id: string) {
    // Read the frozen slug before the row is gone so we can compute the
    // slugged schedule id to remove. Null (never frozen) → undefined →
    // `deleteWorkflowSchedule` targets the legacy slug-less schedule instead.
    const existing = await this.prisma.workflow.findFirst({
      where: { id, orgId, kind: 'STANDARD' },
      select: { temporalSlug: true },
    });
    const result = await this.prisma.workflow.deleteMany({
      where: { id, orgId, kind: 'STANDARD' },
    });
    if (result.count === 0) {
      throw new NotFoundException(`Workflow ${id} not found`);
    }
    // Schedule cleanup is best-effort: the row is gone, so a leaked schedule
    // would fire against a missing workflow and self-recover at next reconcile.
    // Don't promote a Temporal error to a 500 after the DB delete succeeded.
    try {
      await this.temporal.deleteWorkflowSchedule(id, existing?.temporalSlug ?? undefined);
    } catch (err) {
      this.logger.warn(`Deleting schedule for workflow ${id} failed: ${errMessage(err)}`);
    }
  }

  /**
   * Clone a workflow's row + its `Workflow.definition` JSON. Connections are
   * global now — the copied definition keeps the same `connectionId` /
   * `boardConnectionId` references as the source. The duplicate starts paused
   * (`isActive: false`) so it doesn't trigger until the user reviews it.
   *
   * The encrypted `webhookSecret` ciphertext is workflow-agnostic, so the
   * duplicate inherits the same plaintext secret. Webhook URLs are
   * per-workflow (`/hooks/:workflowId`) so the duplicate gets its own URL
   * while reusing the same secret value.
   */
  async duplicate(orgId: string, id: string) {
    const source = orNotFound(
      await this.prisma.workflow.findFirst({
        where: { id, orgId, kind: 'STANDARD' },
      }),
      'Workflow',
      id,
    );

    const created = await this.prisma.workflow.create({
      data: {
        orgId,
        name: `${source.name} (copy)`,
        description: source.description,
        definition: source.definition as unknown as object,
        webhookSecret: source.webhookSecret,
        isActive: false,
      },
    });

    await this.syncWorkflowSchedule(created);
    return created;
  }

  /**
   * Set or rotate the webhook signing secret for a workflow. The plaintext is
   * encrypted server-side with the same AES-256-GCM format as
   * `Credential.secret`; clients send it once over TLS.
   */
  async setWebhookSecret(orgId: string, id: string, plaintext: string) {
    const result = await this.prisma.workflow.updateMany({
      where: { id, orgId, kind: 'STANDARD' },
      data: { webhookSecret: encrypt(plaintext) },
    });
    if (result.count === 0) {
      throw new NotFoundException(`Workflow ${id} not found`);
    }
    const wf = await this.prisma.workflow.findUniqueOrThrow({
      where: { id },
      select: { id: true, updatedAt: true },
    });
    return wf;
  }

  async clearWebhookSecret(orgId: string, id: string) {
    const result = await this.prisma.workflow.updateMany({
      where: { id, orgId, kind: 'STANDARD' },
      data: { webhookSecret: null },
    });
    if (result.count === 0) {
      throw new NotFoundException(`Workflow ${id} not found`);
    }
  }

  /**
   * Keep Temporal's Schedule in sync with the workflow's current trigger:
   *
   *   - polling + isActive    → schedule exists + unpaused (interval spec)
   *   - polling + !isActive   → schedule exists + paused
   *   - cron + isActive       → schedule exists + unpaused (calendar spec)
   *   - cron + !isActive      → schedule exists + paused
   *   - webhook / no trigger  → no schedule (delete if it existed)
   *
   * Schedule failures are logged but never block the workflow write — an
   * inconsistent schedule will be re-reconciled on next save or boot.
   */
  private async syncWorkflowSchedule(wf: {
    id: string;
    name: string;
    definition: unknown;
    isActive: boolean;
    temporalSlug: string | null;
  }): Promise<void> {
    const trigger = (wf.definition as Partial<WorkflowDefinition> | null)?.triggers?.[0];
    try {
      if (!isScheduledTrigger(trigger)) {
        // Teardown: target whatever id the schedule was created under by
        // reading the already-frozen slug. Never re-resolve here — that would
        // freeze a fresh slug and delete the wrong (non-existent) id, leaking
        // the real schedule.
        await this.temporal.deleteWorkflowSchedule(wf.id, wf.temporalSlug ?? undefined);
        return;
      }
      // Materialize: freeze the slug once (no-op read after the first call) so
      // the schedule + the poll/cron runs it spawns all carry the prefix.
      const slug = await resolveTemporalSlug(this.prisma, wf);
      await this.temporal.upsertWorkflowSchedule(
        scheduleOptionsForTrigger(trigger, wf.id, wf.isActive, slug),
      );
    } catch (err) {
      this.logger.warn(`Sync schedule for workflow ${wf.id} failed: ${errMessage(err)}`);
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
  async startRun(orgId: string, workflowId: string, triggerEvent: TriggerEvent) {
    const wf = await this.get(orgId, workflowId);
    const definition = workflowDefinitionSchema.safeParse(wf.definition);
    const ticketLock = definition.success
      ? ticketLockFor(definition.data, workflowId, triggerEvent)
      : undefined;
    // Freeze (or read) the slug so the agent-run id carries the same prefix
    // as the workflow's schedule/poll/cron ids.
    const slug = await resolveTemporalSlug(this.prisma, wf);

    const run = await this.prisma.workflowRun.create({
      data: {
        orgId,
        workflowId,
        status: 'PENDING',
        trigger: triggerEvent as unknown as object,
      },
    });
    try {
      const { temporalWorkflowId, temporalRunId } = await this.temporal.startAgentWorkflow(
        { workflowId, runId: run.id, triggerEvent },
        { ticketLock, slug },
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
