import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  Client,
  Connection,
  ScheduleAlreadyRunning,
  ScheduleClient,
  ScheduleNotFoundError,
  ScheduleOverlapPolicy,
  WorkflowExecutionAlreadyStartedError,
  isGrpcServiceError,
} from '@temporalio/client';
import {
  AGENT_WORKFLOW_TYPE,
  CRON_WORKFLOW_TYPE,
  POLL_WORKFLOW_TYPE,
  agentWorkflowId,
  cronWorkflowId,
  pollWorkflowId,
  workflowScheduleId,
  type CronWorkflowInput,
  type PollWorkflowInput,
  type TicketLock,
  type TriggerEvent,
} from '@conduit/shared';
import { config } from '../config';

/**
 * Thrown when a `ticket-branch` workflow start collides with an in-flight
 * run on the same ticket. Callers are expected to drop the trigger silently
 * and return 200 to the platform (webhook) or skip to the next poll cycle.
 */
export class DuplicateRunError extends Error {
  override readonly name = 'DuplicateRunError';
  constructor(
    public readonly temporalWorkflowId: string,
    cause?: unknown,
  ) {
    super(`Temporal workflow ${temporalWorkflowId} is already running — duplicate trigger dropped`);
    if (cause instanceof Error) this.stack = `${this.stack}\nCaused by: ${cause.stack ?? cause.message}`;
  }
}

export interface AgentWorkflowInput {
  workflowId: string;
  runId: string;
  triggerEvent: TriggerEvent;
}

export interface StartAgentWorkflowOptions {
  /**
   * Populated for `ticket-branch` workflows — keys the Temporal workflow id
   * on `(workflowId, ticketKey)` so concurrent triggers against an in-flight
   * run collide and the second start throws `DuplicateRunError`.
   */
  ticketLock?: TicketLock;
  /**
   * Frozen, human-readable slug woven in front of the run id as a cosmetic
   * prefix. Resolved by the caller; omitted/empty → legacy slug-less id.
   */
  slug?: string;
}

export type WorkflowScheduleOptions =
  | {
      kind: 'polling';
      workflowId: string;
      intervalSec: number;
      /** When false, the schedule is created/updated in a paused state. */
      active: boolean;
      /**
       * Frozen, human-readable slug woven into the schedule + poll-run ids as
       * a cosmetic prefix. Omitted/empty → legacy slug-less ids.
       */
      slug?: string;
    }
  | {
      kind: 'cron';
      workflowId: string;
      cron: string;
      timezone: string;
      /** When false, the schedule is created/updated in a paused state. */
      active: boolean;
      /**
       * Frozen, human-readable slug woven into the schedule + cron-run ids as
       * a cosmetic prefix. Omitted/empty → legacy slug-less ids.
       */
      slug?: string;
    };

/**
 * Thin wrapper around Temporal's `@temporalio/client`. Also owns the
 * schedule lifecycle (upsert/delete) so a single Temporal Schedule tracks
 * each workflow whose trigger is schedule-backed (polling or cron).
 */
@Injectable()
export class TemporalService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TemporalService.name);
  private connection: Connection | undefined;
  private client: Client | undefined;
  private schedules: ScheduleClient | undefined;

  async onModuleInit(): Promise<void> {
    try {
      this.connection = await Connection.connect({ address: config.temporal.address });
      this.client = new Client({
        connection: this.connection,
        namespace: config.temporal.namespace,
      });
      this.schedules = new ScheduleClient({
        connection: this.connection,
        namespace: config.temporal.namespace,
      });
      this.logger.log(`Connected to Temporal at ${config.temporal.address}`);
    } catch (err) {
      this.logger.warn(
        `Could not connect to Temporal at ${config.temporal.address}: ${String(err)}. Runs will fail until Temporal is reachable.`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection?.close();
  }

  async startAgentWorkflow(
    input: AgentWorkflowInput,
    opts: StartAgentWorkflowOptions = {},
  ): Promise<{
    temporalWorkflowId: string;
    temporalRunId: string;
  }> {
    if (!this.client) {
      throw new Error('Temporal client not initialized — check TEMPORAL_ADDRESS');
    }
    const temporalWorkflowId = agentWorkflowId(input.runId, opts.ticketLock, opts.slug);
    try {
      // Temporal defaults already match what ticket-branch needs:
      //   - workflowIdReusePolicy = ALLOW_DUPLICATE — closed workflows' IDs
      //     can be reused, so Dev → Review → Dev board cycles re-fire.
      //   - workflowIdConflictPolicy = FAIL — a second start against a
      //     *running* ID throws WorkflowExecutionAlreadyStartedError, which
      //     we translate to DuplicateRunError below.
      const handle = await this.client.workflow.start(AGENT_WORKFLOW_TYPE, {
        args: [input],
        taskQueue: config.temporal.taskQueue,
        workflowId: temporalWorkflowId,
      });
      return { temporalWorkflowId, temporalRunId: handle.firstExecutionRunId };
    } catch (err) {
      if (err instanceof WorkflowExecutionAlreadyStartedError) {
        throw new DuplicateRunError(temporalWorkflowId, err);
      }
      throw err;
    }
  }

  async cancelAgentWorkflow(temporalWorkflowId: string): Promise<void> {
    if (!this.client) {
      throw new Error('Temporal client not initialized — check TEMPORAL_ADDRESS');
    }
    const handle = this.client.workflow.getHandle(temporalWorkflowId);
    await handle.cancel();
  }

  /**
   * Create or update the Temporal Schedule backing a schedule-driven
   * workflow. Safe to call repeatedly. `overlap = SKIP` ensures a slow
   * tick never overlaps its successor.
   *
   * Two variants share one Schedule shape:
   *   - `polling` → `intervals` spec; action workflow type = `POLL_WORKFLOW_TYPE`.
   *   - `cron`    → `cronExpressions` calendar with `timezoneName`; action
   *                 workflow type = `CRON_WORKFLOW_TYPE`.
   *
   * The schedule id (`workflowScheduleId`) is variant-agnostic so flipping
   * a workflow's trigger from polling to cron updates the same Temporal
   * Schedule in place.
   */
  async upsertWorkflowSchedule(opts: WorkflowScheduleOptions): Promise<void> {
    if (!this.schedules) {
      throw new Error('Temporal client not initialized — check TEMPORAL_ADDRESS');
    }
    const scheduleId = workflowScheduleId(opts.workflowId, opts.slug);
    const scheduleDef = buildScheduleDefinition(opts);

    try {
      await this.schedules.create({
        scheduleId,
        ...scheduleDef,
        state: { paused: !opts.active },
      });
    } catch (err) {
      if (!isScheduleAlreadyRunning(err)) throw err;
      const handle = this.schedules.getHandle(scheduleId);
      await handle.update((prev) => ({ ...prev, ...scheduleDef }));
      if (opts.active) await handle.unpause('conduit: workflow activated');
      else await handle.pause('conduit: workflow deactivated');
    }
  }

  /**
   * Delete the schedule. Idempotent — 404 from Temporal is swallowed so
   * calling on a workflow that never had a schedule is a no-op.
   *
   * `slug` selects which schedule id to remove: callers pass the workflow's
   * frozen `temporalSlug` so the id matches whatever the schedule was created
   * under (a null/empty slug → the slug-less id).
   */
  async deleteWorkflowSchedule(workflowId: string, slug?: string): Promise<void> {
    if (!this.schedules) return;
    try {
      await this.schedules.getHandle(workflowScheduleId(workflowId, slug)).delete();
    } catch (err) {
      if (isScheduleNotFound(err)) return;
      throw err;
    }
  }
}

function buildScheduleDefinition(opts: WorkflowScheduleOptions) {
  if (opts.kind === 'polling') {
    const args: [PollWorkflowInput] = [{ workflowId: opts.workflowId }];
    return {
      spec: { intervals: [{ every: opts.intervalSec * 1000 }] },
      action: {
        type: 'startWorkflow' as const,
        workflowType: POLL_WORKFLOW_TYPE,
        args,
        taskQueue: config.temporal.taskQueue,
        workflowId: pollWorkflowId(opts.workflowId, opts.slug),
      },
      policies: { overlap: ScheduleOverlapPolicy.SKIP },
    };
  }
  const args: [CronWorkflowInput] = [{ workflowId: opts.workflowId }];
  return {
    spec: {
      cronExpressions: [opts.cron],
      timezone: opts.timezone,
    },
    action: {
      type: 'startWorkflow' as const,
      workflowType: CRON_WORKFLOW_TYPE,
      args,
      taskQueue: config.temporal.taskQueue,
      workflowId: cronWorkflowId(opts.workflowId, opts.slug),
    },
    policies: { overlap: ScheduleOverlapPolicy.SKIP },
  };
}

function isScheduleAlreadyRunning(err: unknown): boolean {
  return err instanceof ScheduleAlreadyRunning;
}

const GRPC_NOT_FOUND = 5;

function isScheduleNotFound(err: unknown): boolean {
  if (err instanceof ScheduleNotFoundError) return true;
  if (!isGrpcServiceError(err)) return false;
  return (err as { code?: number }).code === GRPC_NOT_FOUND;
}
