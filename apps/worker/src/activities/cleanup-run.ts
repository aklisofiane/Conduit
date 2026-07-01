import { WorkspaceManager, git, GitError } from '@conduit/agent';
import { errorMessage } from '@conduit/shared/runtime';
import { prisma } from '../runtime/prisma';
import { writeSystemLog } from '../runtime/log-writer';

/**
 * End-of-workflow cleanup.
 *
 *   1. For every completed `NodeRun` with a `ticket-branch` workspace,
 *      check for unpushed commits *locally* (no `git fetch`) and emit a
 *      `WARN` log if any are found. Catches the "nobody ran git push"
 *      footgun without blocking the run. The check is best-effort — a
 *      false positive is possible if the remote advanced mid-run, which
 *      is acceptable per docs/design-docs/agent-execution.md.
 *   2. Delete the run's local workspace tmpdirs (tmpdir rm + worktree
 *      prune). For `ticket-branch`, the *remote* branch stays — that's
 *      the persistent state iteration N+1 consumes.
 *   3. Mark the `WorkflowRun` row terminal.
 *
 * Swallows filesystem errors and logs them — a failure to clean up disk
 * should never block marking the run done.
 */
export async function cleanupRunActivity(input: {
  runId: string;
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED';
  error?: string;
}): Promise<void> {
  const { runId, status, error } = input;
  // Read orgId off the run row we already control — every log/update we
  // write below stays inside the same tenant.
  const run = await prisma().workflowRun.findUnique({
    where: { id: runId },
    select: { orgId: true },
  });
  const orgId = run?.orgId;
  if (orgId) {
    // Best-effort: this pass spawns git inside per-node worktrees, any of
    // which a concurrent run may have evicted. A failure here must never
    // prevent the terminal-status write below, or the run hangs in RUNNING.
    try {
      await warnOnUnpushedTicketBranchCommits(runId, orgId);
    } catch (err) {
      await writeSystemLog(
        runId,
        orgId,
        null,
        `unpushed-commit check failed: ${errorMessage(err)}`,
        'WARN',
      );
    }
  }

  const manager = new WorkspaceManager();
  try {
    await manager.cleanupRun(runId);
  } catch (err) {
    if (orgId) {
      await writeSystemLog(runId, orgId, null, `cleanupRun failed: ${errorMessage(err)}`, 'WARN');
    }
  }

  // Run-level rollup: sum the per-node tokens (from each NodeRun.usage JSON,
  // the single source of truth — no duplication) and the snapshot-at-write
  // `costUsd` into the WorkflowRun aggregate columns. Stays null when no agent
  // node recorded usage. The cost sum runs in SQL to keep Decimal precision.
  const totals = await rollupRunTotals(runId);

  await prisma().workflowRun.update({
    where: { id: runId },
    data: {
      status,
      error: error ?? undefined,
      finishedAt: new Date(),
      ...totals,
    },
  });
}

/** Aggregate the run's NodeRun token usage + cost into WorkflowRun column
 *  updates. Returns `undefined`-valued fields (left as null) when nothing ran. */
async function rollupRunTotals(runId: string): Promise<{
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCostUsd?: import('@conduit/database').Prisma.Decimal;
}> {
  const nodes = await prisma().nodeRun.findMany({
    where: { runId },
    select: { usage: true },
  });

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let hasUsage = false;
  for (const node of nodes) {
    const usage = node.usage as {
      inputTokens?: number;
      outputTokens?: number;
      cachedInputTokens?: number;
      cacheCreationInputTokens?: number;
    } | null;
    if (!usage) continue;
    hasUsage = true;
    // Headline "input" is everything the model read — full-rate plus the cache
    // buckets — so the run total reflects true consumption, not just the
    // uncached slice. Cost is rolled up separately (snapshot costUsd per node).
    totalInputTokens +=
      (usage.inputTokens ?? 0) +
      (usage.cachedInputTokens ?? 0) +
      (usage.cacheCreationInputTokens ?? 0);
    totalOutputTokens += usage.outputTokens ?? 0;
  }

  const costAgg = await prisma().nodeRun.aggregate({
    where: { runId },
    _sum: { costUsd: true },
  });

  return {
    totalInputTokens: hasUsage ? totalInputTokens : undefined,
    totalOutputTokens: hasUsage ? totalOutputTokens : undefined,
    totalCostUsd: costAgg._sum.costUsd ?? undefined,
  };
}

/**
 * Emit a warning for any `ticket-branch` node whose current HEAD differs
 * from the commit the workspace was resolved at. Runs *before* cleanup
 * wipes the workspace, so `git rev-parse HEAD` still works.
 *
 * Local-only check — no `git fetch`. If the agent pushed successfully the
 * warning is a false positive, which is acceptable per
 * docs/design-docs/agent-execution.md: the goal is catching the
 * "nobody ran git push" footgun, not perfectly accounting for every commit.
 */
async function warnOnUnpushedTicketBranchCommits(runId: string, orgId: string): Promise<void> {
  const nodes = await prisma().nodeRun.findMany({
    where: { runId, nodeType: 'AGENT' },
    select: {
      nodeName: true,
      workspacePath: true,
      output: true,
    },
  });

  // Each node's check spawns its own `git rev-list`; they're independent, so
  // fan them out and await once instead of serializing a process per node.
  // Logs are still emitted in node order below so the run timeline is stable.
  const warnings = await Promise.all(
    nodes.map(async (node) => {
      const output = node.output as {
        workspaceKind?: string;
        branchName?: string;
        head?: string;
      } | null;
      const kind = output?.workspaceKind;
      if (kind !== 'ticket-branch' && kind !== 'fixed-branch') return null;
      if (!node.workspacePath || !output?.head || !output.branchName) return null;

      const unpushed = await countCommitsAhead(node.workspacePath, output.head);
      if (unpushed === null || unpushed === 0) return null;
      return { nodeName: node.nodeName, kind, unpushed, branchName: output.branchName };
    }),
  );

  for (const w of warnings) {
    if (!w) continue;
    await writeSystemLog(
      runId,
      orgId,
      w.nodeName,
      w.kind === 'fixed-branch'
        ? `fixed-branch: ${w.unpushed} commit${w.unpushed === 1 ? '' : 's'} on ${w.branchName} past the resolved base — verify the agent pushed.`
        : `ticket-branch: ${w.unpushed} commit${w.unpushed === 1 ? '' : 's'} on ${w.branchName} past the resolved base — if no agent ran \`git push\`, this work is lost on the next iteration.`,
      'WARN',
    );
  }
}

async function countCommitsAhead(
  worktreePath: string,
  resolvedHead: string,
): Promise<number | null> {
  try {
    const out = await git(['rev-list', '--count', `${resolvedHead}..HEAD`], {
      cwd: worktreePath,
    });
    const n = Number.parseInt(out.trim(), 10);
    return Number.isFinite(n) ? n : null;
  } catch (err) {
    if (err instanceof GitError) return null;
    // A vanished worktree (a concurrent run evicted it) makes git's spawn
    // fail with ENOENT on the missing cwd — a plain Error, not a GitError.
    // Treat it as "can't check" rather than letting it escape cleanup.
    if (isMissingWorkspaceError(err)) return null;
    throw err;
  }
}

/** True for the `spawn git ENOENT` Node raises when a process's cwd no longer
 *  exists — distinct from a non-zero git exit (which is a `GitError`). */
function isMissingWorkspaceError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'ENOENT'
  );
}
