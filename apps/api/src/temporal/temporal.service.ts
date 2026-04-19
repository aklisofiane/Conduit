import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  Client,
  Connection,
  ScheduleAlreadyRunning,
  ScheduleClient,
  ScheduleOverlapPolicy,
  isGrpcServiceError,
} from '@temporalio/client';
import {
  AGENT_WORKFLOW_TYPE,
  POLL_WORKFLOW_TYPE,
  pollScheduleId,
  pollWorkflowId,
  type PollWorkflowInput,
  type TriggerEvent,
} from '@conduit/shared';
import { config } from '../config';

// Re-exported for back-compat with modules that previously imported from here.
export { AGENT_WORKFLOW_TYPE };

export interface AgentWorkflowInput {
  workflowId: string;
  runId: string;
  triggerEvent: TriggerEvent;
}

export interface PollScheduleOptions {
  workflowId: string;
  intervalSec: number;
  /** When false, the schedule is created/updated in a paused state. */
  active: boolean;
}

/**
 * Thin wrapper around Temporal's `@temporalio/client`. Workflows are
 * started with `startWorkflow` (handle returned to capture temporalRunId
 * for the DB). Workflow IDs are per-run (`run-<runId>`); ticket-branch
 * workflows will swap in a deterministic id when that workspace kind ships.
 *
 * Polling-trigger lifecycle is also owned here: on workflow save the
 * `WorkflowsService` delegates to `upsertPollSchedule` / `deletePollSchedule`
 * so a single Temporal Schedule tracks each polling workflow. See
 * docs/PLANS.md Phase 4.
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

  async startAgentWorkflow(input: AgentWorkflowInput): Promise<{
    temporalWorkflowId: string;
    temporalRunId: string;
  }> {
    if (!this.client) {
      throw new Error('Temporal client not initialized — check TEMPORAL_ADDRESS');
    }
    const temporalWorkflowId = `run-${input.runId}`;
    const handle = await this.client.workflow.start(AGENT_WORKFLOW_TYPE, {
      args: [input],
      taskQueue: config.temporal.taskQueue,
      workflowId: temporalWorkflowId,
    });
    return { temporalWorkflowId, temporalRunId: handle.firstExecutionRunId };
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
   * to call repeatedly — if the schedule already exists we update its
   * interval/paused state in place rather than failing. Called on workflow
   * create + update + `isActive` toggle.
   *
   * `overlap = SKIP` ensures a slow poll cycle never overlaps its successor.
   */
  async upsertPollSchedule(opts: PollScheduleOptions): Promise<void> {
    if (!this.schedules) {
      throw new Error('Temporal client not initialized — check TEMPORAL_ADDRESS');
    }
    const scheduleId = pollScheduleId(opts.workflowId);
    const args: [PollWorkflowInput] = [{ workflowId: opts.workflowId }];

    try {
      await this.schedules.create({
        scheduleId,
        spec: { intervals: [{ every: `${opts.intervalSec}s` }] },
        action: {
          type: 'startWorkflow',
          workflowType: POLL_WORKFLOW_TYPE,
          args,
          taskQueue: config.temporal.taskQueue,
          workflowId: pollWorkflowId(opts.workflowId),
        },
        policies: { overlap: ScheduleOverlapPolicy.SKIP },
        state: { paused: !opts.active },
      });
    } catch (err) {
      if (!isScheduleAlreadyRunning(err)) throw err;
      const handle = this.schedules.getHandle(scheduleId);
      await handle.update((prev) => ({
        ...prev,
        spec: { intervals: [{ every: `${opts.intervalSec}s` }] },
        action: {
          type: 'startWorkflow',
          workflowType: POLL_WORKFLOW_TYPE,
          args,
          taskQueue: config.temporal.taskQueue,
          workflowId: pollWorkflowId(opts.workflowId),
        },
        policies: { ...prev.policies, overlap: ScheduleOverlapPolicy.SKIP },
      }));
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

function isScheduleNotFound(err: unknown): boolean {
  if (!isGrpcServiceError(err)) return false;
  // gRPC NOT_FOUND
  return (err as { code?: number }).code === 5;
}
