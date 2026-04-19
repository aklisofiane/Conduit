import {
  AGENT_WORKFLOW_TYPE,
  applyFilter,
  matchesTrigger,
  type PollCycleResult,
  type PollWorkflowInput,
  type TriggerEvent,
  type TriggerFilter,
  workflowDefinitionSchema,
} from '@conduit/shared';
import { decryptSecret, loadEncryptionKey } from '@conduit/shared/crypto';
import { config } from '../config';
import { prisma } from '../runtime/prisma';
import { writeSystemLog } from '../runtime/log-writer';
import {
  fetchProjectBoardItems,
  type ProjectBoardItem,
} from '../runtime/github-projects';
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
    return emptyResult(workflowId);
  }

  const definition = workflowDefinitionSchema.parse(wf.definition);
  const { trigger } = definition;
  if (trigger.mode.kind !== 'polling' || !trigger.mode.active) {
    return emptyResult(workflowId);
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

  const matching = items.filter((item) => itemPassesFilters(item, trigger.filters));
  const matchingIds = matching.map((item) => item.itemNodeId).sort();

  const previousIds = readPreviousIds(wf.pollSnapshot?.matchingIds);
  const previousSet = new Set(previousIds);
  const newItems = matching.filter((item) => !previousSet.has(item.itemNodeId));

  // Second gate: the platform query filters by the API's current view, but
  // `matchesTrigger` also enforces platform + filter-field parity against
  // the normalized event. Cheap belt-and-braces.
  const eventsToStart = newItems
    .map((item) => toTriggerEvent(item))
    .filter((event) => matchesTrigger(event, trigger));
  const startedRunIds = (
    await Promise.all(eventsToStart.map((event) => startAgentWorkflow(workflowId, event)))
  ).filter((id): id is string => id !== undefined);

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
    matchedCount: matching.length,
    newCount: newItems.length,
    startedRunIds,
    matchingIds,
  };
}

function emptyResult(workflowId: string): PollCycleResult {
  return {
    workflowId,
    matchedCount: 0,
    newCount: 0,
    startedRunIds: [],
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

async function startAgentWorkflow(
  workflowId: string,
  triggerEvent: TriggerEvent,
): Promise<string | undefined> {
  const run = await prisma().workflowRun.create({
    data: {
      workflowId,
      status: 'PENDING',
      trigger: triggerEvent as unknown as object,
    },
  });
  try {
    const client = await getTemporalClient();
    const temporalWorkflowId = `run-${run.id}`;
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
    return run.id;
  } catch (err) {
    await prisma().workflowRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        error: err instanceof Error ? err.message : String(err),
        finishedAt: new Date(),
      },
    });
    await writeSystemLog(
      run.id,
      null,
      `pollBoardActivity: failed to start agentWorkflow: ${
        err instanceof Error ? err.message : String(err)
      }`,
      'ERROR',
    );
    return undefined;
  }
}
