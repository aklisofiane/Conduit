import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import {
  AGENT_WORKFLOW_TYPE,
  agentWorkflowId,
  connectionScopeSchema,
  expectScopeKind,
  matchesTrigger,
  ticketLockFor,
  type PollCycleResult,
  type PollWorkflowInput,
  type TriggerEvent,
  type WorkflowDefinition,
  workflowDefinitionSchema,
} from '@conduit/shared';
import { decryptSecret, loadEncryptionKey } from '@conduit/shared/crypto';
import { config } from '../config';
import { prisma } from '../runtime/prisma';
import { writeSystemLog } from '../runtime/log-writer';
import {
  fetchProjectBoardItems,
  fetchRepositoryIssues,
  fetchRepositoryPullRequests,
  fetchGitlabProjectIssues,
  fetchGitlabProjectMergeRequests,
} from '@conduit/shared/platform';
import { getTemporalClient } from '../runtime/temporal-client';
import { itemPassesFilters, toTriggerEvent } from './poll-board-helpers';

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
  if (trigger.type === 'webhook' || trigger.type === 'cron') {
    // Non-polling triggers are delivered by their own surface — webhooks
    // controller or the cron workflow. A schedule firing here means a
    // stale Temporal schedule of the wrong type — drop cleanly so reconcile
    // cleans it up on next save.
    return emptyResult(workflowId, 'not-polling');
  }
  const needsBoard = trigger.type === 'issues' && !!trigger.boardConnectionId;

  // Source connection carries the credential for every path; board path also
  // resolves a separate Projects v2 connection for its scope. Fetch both up
  // front so each tick is one round-trip pair, not two serial reads.
  const [sourceConn, boardConn] = await Promise.all([
    prisma().connection.findUnique({
      where: { id: trigger.connectionId },
      include: { credential: true },
    }),
    needsBoard && trigger.boardConnectionId
      ? prisma().connection.findUnique({ where: { id: trigger.boardConnectionId } })
      : Promise.resolve(null),
  ]);
  if (!sourceConn) {
    throw new Error(
      `Workflow ${workflowId} trigger references unknown connection ${trigger.connectionId}`,
    );
  }
  const sourceScope = connectionScopeSchema.parse(sourceConn.scope);
  const token = decryptSecret(sourceConn.credential.secret, loadEncryptionKey());
  const hostUrl = sourceConn.credential.hostUrl;

  const platform = trigger.platform;
  if (platform !== 'github' && platform !== 'gitlab') {
    throw new Error(`Polling for platform "${platform}" not implemented`);
  }

  // Fetch paths dispatched on platform + type + boardConnectionId:
  //
  // GitHub:
  //   - `pull_requests` → repo PRs (a board adds nothing here).
  //   - `issues` + boardConnectionId → Projects v2 board items.
  //   - `issues` (no board) → repo open issues.
  //
  // GitLab:
  //   - `pull_requests` → project merge requests.
  //   - `issues` → project open issues (no board path in v1).
  //
  // All paths return the same `ProjectBoardItem` shape so the rest of the
  // pipeline (filter, dedup, event-build) doesn't care which one fired.
  let items;
  if (platform === 'github') {
    if (trigger.type === 'pull_requests') {
      const repoScope = expectScopeKind(sourceScope, 'github_repo');
      items = await fetchRepositoryPullRequests({
        owner: repoScope.owner,
        name: repoScope.repo,
        token,
      });
    } else if (needsBoard) {
      if (!boardConn) {
        throw new Error(
          `Workflow ${workflowId} trigger references unknown board connection ${trigger.boardConnectionId}`,
        );
      }
      const boardScope = expectScopeKind(
        connectionScopeSchema.parse(boardConn.scope),
        'github_projects_v2',
      );
      const boardItems = await fetchProjectBoardItems({
        ownerType: boardScope.ownerType,
        owner: boardScope.owner,
        projectNumber: boardScope.number,
        token,
      });
      // Drop PRs and DraftIssues so issue triggers only see real issues.
      items = boardItems.filter((item) => item.contentType === 'Issue');
    } else {
      const repoScope = expectScopeKind(sourceScope, 'github_repo');
      items = await fetchRepositoryIssues({
        owner: repoScope.owner,
        name: repoScope.repo,
        token,
      });
    }
  } else {
    const glScope = expectScopeKind(sourceScope, 'gitlab_project');
    const glHost = hostUrl ?? 'gitlab.com';
    if (trigger.type === 'pull_requests') {
      items = await fetchGitlabProjectMergeRequests({
        hostUrl: glHost,
        projectPath: glScope.projectPath,
        token,
      });
    } else {
      items = await fetchGitlabProjectIssues({
        hostUrl: glHost,
        projectPath: glScope.projectPath,
        token,
      });
    }
  }
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
  const candidateEvents = newItems.map((item) => toTriggerEvent(item, trigger.type, platform));
  const eventsToStart = candidateEvents.filter((event) => matchesTrigger(event, trigger));
  const gatedOutCount = candidateEvents.length - eventsToStart.length;

  const outcomes = await Promise.all(
    eventsToStart.map((event) =>
      startAgentWorkflow(workflowId, wf.orgId, definition, event, wf.temporalSlug ?? undefined),
    ),
  );
  const startedRunIds = outcomes
    .filter((o): o is Extract<StartOutcome, { ok: true }> => o.ok)
    .map((o) => o.runId);
  const failedStarts = outcomes
    .filter((o): o is Extract<StartOutcome, { ok: false }> => !o.ok)
    .map(({ reason, error, issueKey }) => ({ reason, error, issueKey }));

  // Exclude gated-out new items from the snapshot so they're retried on
  // the next tick instead of being permanently marked as "seen."
  const startedEventSet = new Set(eventsToStart);
  const gatedOutIds = new Set<string>();
  for (let i = 0; i < candidateEvents.length; i++) {
    if (!startedEventSet.has(candidateEvents[i]!)) {
      gatedOutIds.add(newItems[i]!.itemNodeId);
    }
  }
  const snapshotIds = gatedOutIds.size > 0
    ? matchingIds.filter((id) => !gatedOutIds.has(id))
    : matchingIds;

  const snapshotChanged =
    startedRunIds.length > 0 ||
    snapshotIds.length !== previousIds.length ||
    snapshotIds.some((id, i) => id !== previousIds[i]);
  if (snapshotChanged) {
    await prisma().pollSnapshot.upsert({
      where: { workflowId },
      create: {
        workflowId,
        orgId: wf.orgId,
        matchingIds: snapshotIds as unknown as object,
      },
      update: { matchingIds: snapshotIds as unknown as object, polledAt: new Date() },
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


type StartOutcome =
  | { ok: true; runId: string }
  | { ok: false; reason: 'duplicate' | 'error'; error?: string; issueKey?: string };

async function startAgentWorkflow(
  workflowId: string,
  orgId: string,
  definition: WorkflowDefinition,
  triggerEvent: TriggerEvent,
  slug?: string,
): Promise<StartOutcome> {
  const ticketLock = ticketLockFor(definition, workflowId, triggerEvent);
  const issueKey = triggerEvent.issue?.key;
  const run = await prisma().workflowRun.create({
    data: {
      workflowId,
      orgId,
      status: 'PENDING',
      trigger: triggerEvent as unknown as object,
    },
  });
  try {
    const client = await getTemporalClient();
    // Read-only: the slug was frozen by the API before this schedule existed.
    // Never recompute from the live name — that would diverge from the frozen
    // value and break ticket-branch dedup against an in-flight run.
    const temporalWorkflowId = agentWorkflowId(run.id, ticketLock, slug);
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
      orgId,
      null,
      `pollBoardActivity: failed to start agentWorkflow: ${errMsg}`,
      'ERROR',
    );
    return { ok: false, reason: 'error', error: errMsg, issueKey };
  }
}
