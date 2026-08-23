import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_WORKFLOW_TYPE, agentWorkflowId } from '@conduit/shared';
import type { TicketLock, TriggerEvent } from '@conduit/shared';
import { startAgentRun } from './start-agent-run';

/**
 * `startAgentRun` is the shared start/dedup/row-reconciliation path used by both
 * the cron and poll trigger surfaces. Its three outcomes each leave the
 * placeholder `WorkflowRun` row in a distinct state:
 *
 *   - started   → PENDING flips to RUNNING with temporalWorkflowId/temporalRunId
 *   - duplicate → the placeholder row is DELETEd (Temporal id collision)
 *   - error     → the row is marked FAILED (+ finishedAt) and an ERROR log written
 *
 * Only the I/O edges (prisma, temporal client, log writer) are mocked; the real
 * `agentWorkflowId` / `AGENT_WORKFLOW_TYPE` from `@conduit/shared` run.
 */

const { runCreate, runUpdate, runDelete, getTemporalClient, workflowStart, writeSystemLog } =
  vi.hoisted(() => ({
    runCreate: vi.fn(),
    runUpdate: vi.fn(),
    runDelete: vi.fn(),
    getTemporalClient: vi.fn(),
    workflowStart: vi.fn(),
    writeSystemLog: vi.fn(),
  }));

vi.mock('../runtime/prisma', () => ({
  prisma: () => ({
    workflowRun: { create: runCreate, update: runUpdate, delete: runDelete },
  }),
}));

vi.mock('../runtime/temporal-client', () => ({ getTemporalClient }));

vi.mock('../runtime/log-writer', () => ({ writeSystemLog }));

const TRIGGER_EVENT: TriggerEvent = {
  source: 'github',
  mode: 'polling',
  event: 'issues.opened',
  payload: { number: 42 },
  repo: { owner: 'acme', name: 'shop' },
  issue: {
    id: 'I_1',
    key: '42',
    title: 'Crash on save',
    url: 'https://github.com/acme/shop/issues/42',
  },
};

const BASE_PARAMS = {
  workflowId: 'wf_1',
  orgId: 'org_1',
  triggerEvent: TRIGGER_EVENT,
  logLabel: 'pollBoardActivity',
};

describe('startAgentRun', () => {
  beforeEach(() => {
    runCreate.mockResolvedValue({ id: 'run_1' });
    runUpdate.mockResolvedValue({});
    runDelete.mockResolvedValue({});
    workflowStart.mockResolvedValue({ firstExecutionRunId: 'temporal_run_1' });
    getTemporalClient.mockResolvedValue({ workflow: { start: workflowStart } });
    writeSystemLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates a PENDING row, flips it to RUNNING, and returns started', async () => {
    const result = await startAgentRun(BASE_PARAMS);

    // The placeholder row is created PENDING with the normalized trigger.
    expect(runCreate).toHaveBeenCalledOnce();
    expect(runCreate.mock.calls[0]![0].data).toMatchObject({
      workflowId: 'wf_1',
      orgId: 'org_1',
      status: 'PENDING',
      trigger: TRIGGER_EVENT,
    });

    // Reconciled to RUNNING and stamped with the Temporal identifiers.
    expect(runUpdate).toHaveBeenCalledOnce();
    expect(runUpdate.mock.calls[0]![0]).toEqual({
      where: { id: 'run_1' },
      data: {
        status: 'RUNNING',
        temporalWorkflowId: agentWorkflowId('run_1', undefined, undefined),
        temporalRunId: 'temporal_run_1',
      },
    });

    expect(runDelete).not.toHaveBeenCalled();
    expect(writeSystemLog).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'started', runId: 'run_1' });
  });

  it('starts the workflow with the derived id, AGENT_WORKFLOW_TYPE, and trigger event', async () => {
    const ticketLock: TicketLock = { workflowId: 'wf_1', ticketKey: '42' };
    await startAgentRun({ ...BASE_PARAMS, ticketLock, slug: 'shop-bot' });

    const expectedId = agentWorkflowId('run_1', ticketLock, 'shop-bot');
    expect(workflowStart).toHaveBeenCalledOnce();
    const [type, opts] = workflowStart.mock.calls[0]!;
    expect(type).toBe(AGENT_WORKFLOW_TYPE);
    expect(opts.workflowId).toBe(expectedId);
    expect(opts.args[0]).toEqual({
      workflowId: 'wf_1',
      runId: 'run_1',
      triggerEvent: TRIGGER_EVENT,
    });

    // The id derived for the start must match the one persisted on the row.
    expect(runUpdate.mock.calls[0]![0].data.temporalWorkflowId).toBe(expectedId);
  });

  it('deletes the placeholder row and returns duplicate on an already-started collision', async () => {
    workflowStart.mockRejectedValue(
      new WorkflowExecutionAlreadyStartedError(
        'already started',
        'run-wf_1-42',
        AGENT_WORKFLOW_TYPE,
      ),
    );

    const result = await startAgentRun(BASE_PARAMS);

    expect(runDelete).toHaveBeenCalledOnce();
    expect(runDelete.mock.calls[0]![0]).toEqual({ where: { id: 'run_1' } });

    // No FAILED reconciliation and no system log on the dedup path.
    expect(runUpdate).not.toHaveBeenCalled();
    expect(writeSystemLog).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'duplicate' });
  });

  it('marks the row FAILED, writes an ERROR log, and returns error on a generic failure', async () => {
    workflowStart.mockRejectedValue(new Error('Temporal unreachable'));

    const result = await startAgentRun(BASE_PARAMS);

    expect(runDelete).not.toHaveBeenCalled();
    expect(runUpdate).toHaveBeenCalledOnce();
    const updateArg = runUpdate.mock.calls[0]![0];
    expect(updateArg.where).toEqual({ id: 'run_1' });
    expect(updateArg.data.status).toBe('FAILED');
    expect(updateArg.data.error).toBe('Temporal unreachable');
    expect(updateArg.data.finishedAt).toBeInstanceOf(Date);

    expect(writeSystemLog).toHaveBeenCalledOnce();
    expect(writeSystemLog).toHaveBeenCalledWith(
      'run_1',
      'org_1',
      null,
      expect.stringContaining(
        'pollBoardActivity: failed to start agentWorkflow: Temporal unreachable',
      ),
      'ERROR',
    );

    expect(result).toEqual({ status: 'error', runId: 'run_1', error: 'Temporal unreachable' });
  });

  it('swallows a delete failure in the duplicate catch path and still resolves', async () => {
    workflowStart.mockRejectedValue(
      new WorkflowExecutionAlreadyStartedError(
        'already started',
        'run-wf_1-42',
        AGENT_WORKFLOW_TYPE,
      ),
    );
    runDelete.mockRejectedValue(new Error('row already gone'));

    await expect(startAgentRun(BASE_PARAMS)).resolves.toEqual({ status: 'duplicate' });
    expect(runDelete).toHaveBeenCalledOnce();
  });

  it('swallows update/log failures in the error catch path and still resolves', async () => {
    workflowStart.mockRejectedValue(new Error('Temporal unreachable'));
    runUpdate.mockRejectedValue(new Error('db down'));
    writeSystemLog.mockRejectedValue(new Error('log sink down'));

    await expect(startAgentRun(BASE_PARAMS)).resolves.toEqual({
      status: 'error',
      runId: 'run_1',
      error: 'Temporal unreachable',
    });
    expect(runUpdate).toHaveBeenCalledOnce();
    expect(writeSystemLog).toHaveBeenCalledOnce();
  });
});
