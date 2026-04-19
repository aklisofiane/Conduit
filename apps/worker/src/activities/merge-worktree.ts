import { git, GitError, mergeBranchedWorktree, MergeConflictError } from '@conduit/agent';
import { writeSystemLog } from '../runtime/log-writer';

export interface MergeWorktreeInput {
  runId: string;
  /** Parallel-branched worktree path (source of the merge). */
  sourceWorkspacePath: string;
  /** Upstream worktree path (target of the merge). */
  targetWorkspacePath: string;
  /** Name of the parallel node whose worktree is being merged back. */
  sourceNodeName: string;
  /** Upstream node name — appears in commit / log messages for readability. */
  targetNodeName: string;
}

/**
 * Merge a parallel-branched worktree back into its upstream. Called once per
 * parallel sibling, sequentially, in definition order — each merge sees the
 * cumulative result of its predecessors (deterministic across re-runs).
 *
 * Uncommitted changes in the source are folded into a single commit first so
 * `git merge --no-edit --no-ff` has something to operate on. `.conduit/` is
 * excluded from that commit via pathspec — it's gitignored by design, but
 * we don't assume the user's repo carries that rule.
 */
export async function mergeWorktreeActivity(input: MergeWorktreeInput): Promise<void> {
  const { runId, sourceWorkspacePath, targetWorkspacePath, sourceNodeName, targetNodeName } = input;

  try {
    await git(['add', '-A', '--', '.', ':(exclude).conduit'], { cwd: sourceWorkspacePath });
  } catch (err) {
    // Non-git workspaces (fresh-tmpdir) have nothing to merge — bail cleanly.
    if (err instanceof GitError) return;
    throw err;
  }
  const hasStaged = await stagedChangesExist(sourceWorkspacePath);
  if (hasStaged) {
    await git(
      [
        '-c',
        'user.email=conduit@local',
        '-c',
        'user.name=Conduit',
        'commit',
        '-m',
        `Conduit: ${sourceNodeName} changes`,
      ],
      { cwd: sourceWorkspacePath },
    );
  }

  const [sourceHead, targetHead] = await Promise.all([
    git(['rev-parse', 'HEAD'], { cwd: sourceWorkspacePath }).then((s) => s.trim()),
    git(['rev-parse', 'HEAD'], { cwd: targetWorkspacePath }).then((s) => s.trim()),
  ]);
  if (sourceHead === targetHead) {
    await writeSystemLog(
      runId,
      targetNodeName,
      `merge ${sourceNodeName} → ${targetNodeName}: no new commits, skipping`,
    );
    return;
  }

  try {
    await mergeBranchedWorktree({
      targetWorkspacePath,
      sourceRef: sourceHead,
      sourceNodeName,
    });
    await writeSystemLog(
      runId,
      targetNodeName,
      `merged ${sourceNodeName} (${sourceHead.slice(0, 7)}) into ${targetNodeName}`,
    );
  } catch (err) {
    if (err instanceof MergeConflictError) {
      await writeSystemLog(
        runId,
        targetNodeName,
        `merge conflict: ${sourceNodeName} → ${targetNodeName}: ${err.conflicts.join(', ')}`,
        'ERROR',
      );
    }
    throw err;
  }
}

async function stagedChangesExist(cwd: string): Promise<boolean> {
  try {
    await git(['diff', '--cached', '--quiet'], { cwd });
    return false;
  } catch {
    return true;
  }
}
