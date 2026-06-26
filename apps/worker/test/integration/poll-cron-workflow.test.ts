import path from 'node:path';
import { type WorkflowBundle, Worker, bundleWorkflowCode } from '@temporalio/worker';
import type { TestWorkflowEnvironment } from '@temporalio/testing';
import type { CronWorkflowInput, PollCycleResult, PollWorkflowInput } from '@conduit/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestWorkflowEnv } from '../../../../test/helpers/temporal';
import type { CronFireResult } from '../../src/activities/cron-fire';
import { pollWorkflow } from '../../src/workflows/poll-workflow';
import { cronWorkflow } from '../../src/workflows/cron-workflow';

/**
 * Temporal-level integration for the two scheduled "tick" workflows. They are
 * thin passthroughs to a single activity, so the contract worth pinning is the
 * `proxyActivities` retry config: a transient failure is retried up to the
 * cap, a `ValidationError` is non-retryable, and the activity result is
 * returned verbatim (it's surfaced in each tick's "Result" tab).
 */

/** Mimics a non-retryable failure — Temporal matches on the error `name`. */
class ValidationError extends Error {
  override readonly name = 'ValidationError';
}

const POLL_RESULT: PollCycleResult = {
  workflowId: 'wf_poll',
  fetchedCount: 3,
  matchedCount: 2,
  alreadySeenCount: 1,
  newCount: 1,
  gatedOutCount: 0,
  startedRunIds: ['run_a'],
  failedStarts: [],
  matchingIds: ['PVTI_1', 'PVTI_2'],
};

const CRON_RESULT: CronFireResult = {
  workflowId: 'wf_cron',
  startedRunId: 'run_b',
};

describe('poll/cron tick workflows (TestWorkflowEnvironment)', () => {
  let env: TestWorkflowEnvironment;
  let bundle: WorkflowBundle;
  let taskQueueSeq = 0;
  let pollAttempts: number;
  let cronAttempts: number;
  /** Behavior: 'ok' | 'transient-then-ok' | 'validation'. */
  let pollMode: 'ok' | 'transient-then-ok' | 'validation';
  let cronMode: 'ok' | 'validation';

  beforeAll(async () => {
    env = await createTestWorkflowEnv();
    bundle = await bundleWorkflowCode({
      workflowsPath: path.resolve(__dirname, '../../src/workflows/index.ts'),
    });
  }, 120_000);

  afterAll(async () => {
    await env?.teardown();
  });

  beforeEach(() => {
    pollAttempts = 0;
    cronAttempts = 0;
    pollMode = 'ok';
    cronMode = 'ok';
  });

  function makeActivities() {
    return {
      async pollBoardActivity(_input: PollWorkflowInput): Promise<PollCycleResult> {
        pollAttempts += 1;
        if (pollMode === 'validation') throw new ValidationError('bad config');
        if (pollMode === 'transient-then-ok' && pollAttempts < 2) {
          throw new Error('upstream flaked');
        }
        return POLL_RESULT;
      },
      async cronFireActivity(_input: CronWorkflowInput): Promise<CronFireResult> {
        cronAttempts += 1;
        if (cronMode === 'validation') throw new ValidationError('bad cron');
        return CRON_RESULT;
      },
    };
  }

  async function runPoll(): Promise<PollCycleResult> {
    const taskQueue = `poll-int-${taskQueueSeq++}`;
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowBundle: bundle,
      activities: makeActivities(),
    });
    return worker.runUntil(
      env.client.workflow.execute(pollWorkflow, {
        args: [{ workflowId: 'wf_poll' }],
        workflowId: `poll-exec-${taskQueue}`,
        taskQueue,
      }),
    );
  }

  async function runCron(): Promise<CronFireResult> {
    const taskQueue = `cron-int-${taskQueueSeq++}`;
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowBundle: bundle,
      activities: makeActivities(),
    });
    return worker.runUntil(
      env.client.workflow.execute(cronWorkflow, {
        args: [{ workflowId: 'wf_cron' }],
        workflowId: `cron-exec-${taskQueue}`,
        taskQueue,
      }),
    );
  }

  it('pollWorkflow returns the activity result verbatim', async () => {
    const result = await runPoll();
    expect(result).toEqual(POLL_RESULT);
    expect(pollAttempts).toBe(1);
  });

  it('pollWorkflow retries a transient failure (time-skipping) and succeeds', async () => {
    pollMode = 'transient-then-ok';
    const result = await runPoll();
    expect(result).toEqual(POLL_RESULT);
    expect(pollAttempts).toBe(2); // first threw, second succeeded
  });

  it('pollWorkflow does not retry a ValidationError', async () => {
    pollMode = 'validation';
    await expect(runPoll()).rejects.toThrow();
    expect(pollAttempts).toBe(1); // non-retryable — single attempt
  });

  it('cronWorkflow returns the activity result verbatim', async () => {
    const result = await runCron();
    expect(result).toEqual(CRON_RESULT);
    expect(cronAttempts).toBe(1);
  });

  it('cronWorkflow does not retry a ValidationError', async () => {
    cronMode = 'validation';
    await expect(runCron()).rejects.toThrow();
    expect(cronAttempts).toBe(1);
  });
});
