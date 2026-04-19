import { WorkspaceManager, git, GitError } from '@conduit/agent';
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
  await warnOnUnpushedTicketBranchCommits(runId);

  const manager = new WorkspaceManager();
  try {
    await manager.cleanupRun(runId);
  } catch (err) {
    await writeSystemLog(
      runId,
      null,
      `cleanupRun failed: ${err instanceof Error ? err.message : String(err)}`,
      'WARN',
    );
  }
  await prisma().workflowRun.update({
    where: { id: runId },
    data: {
      status,
      error: error ?? undefined,
      finishedAt: new Date(),
    },
  });
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
async function warnOnUnpushedTicketBranchCommits(runId: string): Promise<void> {
  const nodes = await prisma().nodeRun.findMany({
    where: { runId, nodeType: 'AGENT' },
    select: {
      nodeName: true,
      workspacePath: true,
      output: true,
    },
  });

  for (const node of nodes) {
    const output = node.output as {
      workspaceKind?: string;
      branchName?: string;
      head?: string;
    } | null;
    if (output?.workspaceKind !== 'ticket-branch') continue;
    if (!node.workspacePath || !output.head || !output.branchName) continue;

    const unpushed = await countCommitsAhead(node.workspacePath, output.head);
    if (unpushed === null || unpushed === 0) continue;
    await writeSystemLog(
      runId,
      node.nodeName,
      `ticket-branch: ${unpushed} commit${unpushed === 1 ? '' : 's'} on ${output.branchName} ` +
        `past the resolved base — if no agent ran \`git push\`, this work is lost on the next iteration.`,
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
    throw err;
  }
}
