import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Client, Connection } from '@temporalio/client';
import type { TriggerEvent } from '@conduit/shared';
import { config } from '../config';

export const AGENT_WORKFLOW_TYPE = 'agentWorkflow';

export interface AgentWorkflowInput {
  workflowId: string;
  runId: string;
  triggerEvent: TriggerEvent;
}

/**
 * Thin wrapper around Temporal's `@temporalio/client`. Workflows are
 * started with `startWorkflow` (handle returned to capture temporalRunId
 * for the DB). Workflow IDs are per-run (`run-<runId>`); ticket-branch
 * workflows will swap in a deterministic id when that workspace kind ships.
 */
@Injectable()
export class TemporalService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TemporalService.name);
  private connection: Connection | undefined;
  private client: Client | undefined;

  async onModuleInit(): Promise<void> {
    try {
      this.connection = await Connection.connect({ address: config.temporal.address });
      this.client = new Client({
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
}
