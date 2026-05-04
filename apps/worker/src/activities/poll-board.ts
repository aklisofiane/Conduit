import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import {
  AGENT_WORKFLOW_TYPE,
  agentWorkflowId,
  applyFilter,
  matchesTrigger,
  ticketLockFor,
  type PollCycleResult,
  type PollWorkflowInput,
  type TriggerEvent,
  type TriggerFilter,
  type WorkflowDefinition,
  workflowDefinitionSchema,
} from '@conduit/shared';
import { decryptSecret, loadEncryptionKey } from '@conduit/shared/crypto';
import { config } from '../config';
import { prisma } from '../runtime/prisma';
import { writeSystemLog } from '../runtime/log-writer';
import {
  fetchProjectBoardItems,
  type ProjectBoardItem,
} from '@conduit/shared/platform';
import { getTemporalClient } from '../runtime/temporal-client';

/**
 * One poll cycle. Diffs the current matching set against `PollSnapshot`;
 * re-entry (item leaves then returns) re-triggers — board loops depend on
 * this. Snapshot is upserted after run starts so a crash re-processes those
 * items instead of silently dropping them (worst case: duplicate run).
 * Trigger config is re-read + re-parsed on every tick so edits take effect
 * on the next scheduled tick without needing to rewrite the schedule.
 */
export async function pollBoardActivity(
  input: PollWorkflowInput,
): Promise<PollCycleResult> {
  const { workflowId } = input;

  const wf = await prisma().workflow.findUnique({
    where: { id: workflowId },
    include: { pollSnapshot: true },
  });
  if (!wf) throw new Error(`Workflow ${workflowId} not found`);
  if (!wf.isActive) {
    // Schedule may fire between an `isActive=false` flip and the schedule
    // pause reaching the server. Drop cleanly.
    return emptyResult(workflowId, 'inactive');
  }

  const definition = workflowDefinitionSchema.parse(wf.definition);
  const trigger = definition.triggers[0];
  if (!trigger) {
    return emptyResult(workflowId, 'not-polling');
  }
  if (trigger.mode.kind !== 'polling') {
    return emptyResult(workflowId, 'not-polling');
  }
  if (trigger.platform !== 'github') {
    throw new Error(`Polling for platform "${trigger.platform}" not implemented`);
  }
  if (!trigger.board) {
    throw new Error(`Workflow ${workflowId} polling trigger has no board reference`);
  }

  const connection = await prisma().workflowConnection.findUnique({
    where: { id: trigger.connectionId },
    include: { credential: true },
  });
  if (!connection) {
    throw new Error(
      `Workflow ${workflowId} trigger references unknown connection ${trigger.connectionId}`,
    );
  }
  const token = decryptSecret(connection.credential.secret, loadEncryptionKey());

  const items = await fetchProjectBoardItems({
    ownerType: trigger.board.ownerType,
    owner: trigger.board.owner,
    projectNumber: trigger.board.number,
    token,
  });
  const fetchedCount = items.length;

  const matching = items.filter((item) => itemPassesFilters(item, trigger.filters));
  const matchingIds = matching.map((item) => item.itemNodeId).sort();

  const previousIds = readPreviousIds(wf.pollSnapshot?.matchingIds);
  const previousSet = new Set(previousIds);
  const newItems = matching.filter((item) => !previousSet.has(item.itemNodeId));
  const alreadySeenCount = matching.length - newItems.length;

  // Second gate: the platform query filters by the API's current view, but
  // `matchesTrigger` also enforces platform + filter-field parity against
  // the normalized event. Cheap belt-and-braces.
  const candidateEvents = newItems.map((item) => toTriggerEvent(item));
  const eventsToStart = candidateEvents.filter((event) => matchesTrigger(event, trigger));
  const gatedOutCount = candidateEvents.length - eventsToStart.length;

  const outcomes = await Promise.all(
    eventsToStart.map((event) => startAgentWorkflow(workflowId, definition, event)),
  );
  const startedRunIds = outcomes
    .filter((o): o is Extract<StartOutcome, { ok: true }> => o.ok)
    .map((o) => o.runId);
  const failedStarts = outcomes
    .filter((o): o is Extract<StartOutcome, { ok: false }> => !o.ok)
    .map(({ reason, error, issueKey }) => ({ reason, error, issueKey }));

  const snapshotChanged =
    startedRunIds.length > 0 ||
    matchingIds.length !== previousIds.length ||
    matchingIds.some((id, i) => id !== previousIds[i]);
  if (snapshotChanged) {
    await prisma().pollSnapshot.upsert({
      where: { workflowId },
      create: { workflowId, matchingIds: matchingIds as unknown as object },
      update: { matchingIds: matchingIds as unknown as object, polledAt: new Date() },
    });
  }

  return {
    workflowId,
    fetchedCount,
    matchedCount: matching.length,
    alreadySeenCount,
    newCount: newItems.length,
    gatedOutCount,
    startedRunIds,
    failedStarts,
    matchingIds,
  };
}

function emptyResult(
  workflowId: string,
  skipReason?: PollCycleResult['skipReason'],
): PollCycleResult {
  return {
    workflowId,
    skipReason,
    fetchedCount: 0,
    matchedCount: 0,
    alreadySeenCount: 0,
    newCount: 0,
    gatedOutCount: 0,
    startedRunIds: [],
    failedStarts: [],
    matchingIds: [],
  };
}

function readPreviousIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string');
}

/**
 * Build the flat field view for a project board item and run the trigger's
 * filters against it. Mirrors the webhook-side flatten+apply dance in
 * `matchesTrigger` so the user can write one filter set and have it work
 * for either mode.
 */
function itemPassesFilters(item: ProjectBoardItem, filters: TriggerFilter[]): boolean {
  const fields: Record<string, string> = {};
  // Surface every single-select field under its own name so users can
  // filter on `Priority` etc., not just `Status`. `status` is always
  // populated (lowercase) from `Status` when present — matches the webhook
  // flattener in `match.ts` and the docs' canonical example.
  for (const [name, value] of Object.entries(item.singleSelectValues)) {
    fields[name] = value;
  }
  if (item.singleSelectValues.Status !== undefined) {
    fields.status = item.singleSelectValues.Status;
  }
  if (item.contentKey) fields['issue.key'] = item.contentKey;
  if (item.contentTitle) fields['issue.title'] = item.contentTitle;
  if (item.repo) {
    fields['repo.owner'] = item.repo.owner;
    fields['repo.name'] = item.repo.name;
  }

  return filters.every((f) => applyFilter(fields, f));
}

function toTriggerEvent(item: ProjectBoardItem): TriggerEvent {
  const payload: Record<string, unknown> = {
    projectItemNodeId: item.itemNodeId,
    singleSelectValues: item.singleSelectValues,
    contentNodeId: item.contentNodeId,
    contentType: item.contentType,
  };
  // Surface Status directly on the payload so filter-flattener picks it up
  // and so downstream agents see the column name without having to dig.
  if (item.singleSelectValues.Status) {
    payload.status = item.singleSelectValues.Status;
  }

  const event: TriggerEvent = {
    source: 'github',
    mode: 'polling',
    event: 'board.column.changed',
    payload,
  };
  if (item.repo) event.repo = item.repo;
  if (item.contentNodeId && item.contentKey && item.contentTitle && item.contentUrl) {
    event.issue = {
      id: item.contentNodeId,
      key: item.contentKey,
      title: item.contentTitle,
      url: item.contentUrl,
    };
  }
  return event;
}

type StartOutcome =
  | { ok: true; runId: string }
  | { ok: false; reason: 'duplicate' | 'error'; error?: string; issueKey?: string };

async function startAgentWorkflow(
  workflowId: string,
  definition: WorkflowDefinition,
  triggerEvent: TriggerEvent,
): Promise<StartOutcome> {
  const ticketLock = ticketLockFor(definition, workflowId, triggerEvent);
  const issueKey = triggerEvent.issue?.key;
  const run = await prisma().workflowRun.create({
    data: {
      workflowId,
      status: 'PENDING',
      trigger: triggerEvent as unknown as object,
    },
  });
  try {
    const client = await getTemporalClient();
    const temporalWorkflowId = agentWorkflowId(run.id, ticketLock);
    const handle = await client.workflow.start(AGENT_WORKFLOW_TYPE, {
      args: [{ workflowId, runId: run.id, triggerEvent }],
      taskQueue: config.temporal.taskQueue,
      workflowId: temporalWorkflowId,
    });
    await prisma().workflowRun.update({
      where: { id: run.id },
      data: {
        status: 'RUNNING',
        temporalWorkflowId,
        temporalRunId: handle.firstExecutionRunId,
      },
    });
    return { ok: true, runId: run.id };
  } catch (err) {
    if (err instanceof WorkflowExecutionAlreadyStartedError) {
      // Another Conduit start is in flight for this ticket — drop this one.
      await prisma().workflowRun.delete({ where: { id: run.id } }).catch(() => undefined);
      return { ok: false, reason: 'duplicate', issueKey };
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    await prisma().workflowRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        error: errMsg,
        finishedAt: new Date(),
      },
    });
    await writeSystemLog(
      run.id,
      null,
      `pollBoardActivity: failed to start agentWorkflow: ${errMsg}`,
      'ERROR',
    );
    return { ok: false, reason: 'error', error: errMsg, issueKey };
  }
}
