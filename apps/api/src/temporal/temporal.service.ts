import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  Client,
  Connection,
  ScheduleAlreadyRunning,
  ScheduleClient,
  ScheduleOverlapPolicy,
  WorkflowExecutionAlreadyStartedError,
  isGrpcServiceError,
} from '@temporalio/client';
import {
  AGENT_WORKFLOW_TYPE,
  POLL_WORKFLOW_TYPE,
  agentWorkflowId,
  pollScheduleId,
  pollWorkflowId,
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
}

export interface PollScheduleOptions {
  workflowId: string;
  intervalSec: number;
  /** When false, the schedule is created/updated in a paused state. */
  active: boolean;
}

/**
 * Thin wrapper around Temporal's `@temporalio/client`. Also owns the
 * polling-trigger Schedule lifecycle (upsert/delete) so a single
 * Temporal Schedule tracks each polling workflow.
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
    const temporalWorkflowId = agentWorkflowId(input.runId, opts.ticketLock);
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
   * Create or update the Temporal Schedule backing a polling workflow. Safe
   * to call repeatedly. `overlap = SKIP` ensures a slow poll cycle never
   * overlaps its successor.
   */
  async upsertPollSchedule(opts: PollScheduleOptions): Promise<void> {
    if (!this.schedules) {
      throw new Error('Temporal client not initialized — check TEMPORAL_ADDRESS');
    }
    const scheduleId = pollScheduleId(opts.workflowId);
    const args: [PollWorkflowInput] = [{ workflowId: opts.workflowId }];
    const intervalMs = opts.intervalSec * 1000;
    const scheduleDef = {
      spec: { intervals: [{ every: intervalMs }] },
      action: {
        type: 'startWorkflow' as const,
        workflowType: POLL_WORKFLOW_TYPE,
        args,
        taskQueue: config.temporal.taskQueue,
        workflowId: pollWorkflowId(opts.workflowId),
      },
      policies: { overlap: ScheduleOverlapPolicy.SKIP },
    };

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
   */
  async deletePollSchedule(workflowId: string): Promise<void> {
    if (!this.schedules) return;
    try {
      await this.schedules.getHandle(pollScheduleId(workflowId)).delete();
    } catch (err) {
      if (isScheduleNotFound(err)) return;
      throw err;
    }
  }
}

function isScheduleAlreadyRunning(err: unknown): boolean {
  return err instanceof ScheduleAlreadyRunning;
}

const GRPC_NOT_FOUND = 5;

function isScheduleNotFound(err: unknown): boolean {
  if (!isGrpcServiceError(err)) return false;
  return (err as { code?: number }).code === GRPC_NOT_FOUND;
}
