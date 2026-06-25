import {
  connectionScopeSchema,
  expectScopeKind,
  workflowDefinitionSchema,
  type CronWorkflowInput,
  type TriggerEvent,
} from '@conduit/shared';
import { splitProjectPath } from '@conduit/shared/platform';
import { prisma } from '../runtime/prisma';
import { startAgentRun } from './start-agent-run';

/**
 * One cron tick. Re-reads the workflow + trigger config so a config edit
 * takes effect on the next tick without needing to rewrite the schedule.
 * The activity is intentionally minimal — it builds the `cron.fired`
 * `TriggerEvent` and starts the `agentWorkflow`. No filtering, no diffing,
 * no `TicketLock`: cron has no ticket dimension to dedup on, and overlap
 * policy `SKIP` on the schedule already prevents a slow run from
 * overlapping its successor.
 *
 * Returns the started `WorkflowRun.id` (or `null` when the workflow is
 * paused / no longer cron-driven) so the cron workflow's "Result" tab in
 * Temporal UI tells the story.
 */
export interface CronFireResult {
  workflowId: string;
  skipReason?: 'inactive' | 'not-cron';
  startedRunId: string | null;
  error?: string;
}

export async function cronFireActivity(input: CronWorkflowInput): Promise<CronFireResult> {
  const { workflowId } = input;

  const wf = await prisma().workflow.findUnique({
    where: { id: workflowId },
  });
  if (!wf) throw new Error(`Workflow ${workflowId} not found`);
  if (!wf.isActive) {
    return { workflowId, skipReason: 'inactive', startedRunId: null };
  }

  const definition = workflowDefinitionSchema.parse(wf.definition);
  const trigger = definition.triggers[0];
  if (!trigger || trigger.type !== 'cron') {
    // Stale schedule — drop cleanly so reconcile cleans it up on next save.
    return { workflowId, skipReason: 'not-cron', startedRunId: null };
  }

  const conn = await prisma().connection.findUnique({
    where: { id: trigger.connectionId },
  });
  if (!conn) {
    throw new Error(
      `Workflow ${workflowId} cron trigger references unknown connection ${trigger.connectionId}`,
    );
  }
  const platform = trigger.platform;
  const parsedScope = connectionScopeSchema.parse(conn.scope);

  let repo: TriggerEvent['repo'];
  if (platform === 'gitlab') {
    const scope = expectScopeKind(parsedScope, 'gitlab_project');
    const { owner, name } = splitProjectPath(scope.projectPath);
    repo = { owner, name };
  } else {
    const scope = expectScopeKind(parsedScope, 'github_repo');
    repo = { owner: scope.owner, name: scope.repo };
  }

  const triggerEvent: TriggerEvent = {
    source: platform,
    mode: 'scheduled',
    event: 'cron.fired',
    payload: {
      cron: trigger.cron,
      timezone: trigger.timezone,
      branch: trigger.branch,
    },
    repo,
  };

  // Cron has no ticket dimension to dedup on, so no `ticketLock` — a
  // `duplicate` outcome here would mean a per-run id collision, which can't
  // happen. Surface it the same way the old code did (null run, 'duplicate').
  const result = await startAgentRun({
    workflowId,
    orgId: wf.orgId,
    triggerEvent,
    slug: wf.temporalSlug ?? undefined,
    logLabel: 'cronFireActivity',
  });
  switch (result.status) {
    case 'started':
      return { workflowId, startedRunId: result.runId };
    case 'duplicate':
      return { workflowId, startedRunId: null, error: 'duplicate' };
    case 'error':
      // Re-throw so the Temporal activity fails and its retry policy applies —
      // the row is already marked FAILED and logged by startAgentRun.
      throw new Error(result.error);
  }
}
