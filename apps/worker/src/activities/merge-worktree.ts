import fs from 'node:fs/promises';
import path from 'node:path';
import { git, mergeBranchedWorktree, MergeConflictError } from '@conduit/agent';
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
 * Merge a parallel-branched worktree back into its upstream. Phase 3 ships
 * the clean-merge happy path only: uncommitted changes in the branched
 * worktree are captured into a single "Conduit: <Node>" commit so the merge
 * has something to operate on, then a `git merge --no-edit --no-ff` is
 * performed in the target. If the merge conflicts, we throw
 * `MergeConflictError`; the conflict-resolution agent session (see
 * agent-execution.md) is deferred.
 *
 * The activity is called once per parallel sibling, sequentially, in
 * definition order — each merge therefore sees the cumulative result of its
 * predecessors (deterministic across re-runs).
 */
export async function mergeWorktreeActivity(input: MergeWorktreeInput): Promise<void> {
  const { runId, sourceWorkspacePath, targetWorkspacePath, sourceNodeName, targetNodeName } = input;

  if (!(await isGitWorktree(sourceWorkspacePath)) || !(await isGitWorktree(targetWorkspacePath))) {
    // fresh-tmpdir / non-repo workspaces never get merged — nothing to do.
    return;
  }

  // Stage anything the agent left uncommitted and fold it into a single
  // merge-friendly commit on the source worktree. `.conduit/` is gitignored
  // by design (per docs/design-docs/agent-context.md) — but we don't assume
  // the user's repo actually has that gitignore rule, so we explicitly
  // unstage the folder here instead of relying on it.
  await git(['add', '-A'], { cwd: sourceWorkspacePath });
  await git(['reset', '--quiet', 'HEAD', '--', '.conduit'], {
    cwd: sourceWorkspacePath,
  }).catch(() => undefined);
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

  const sourceHead = (await git(['rev-parse', 'HEAD'], { cwd: sourceWorkspacePath })).trim();
  const targetHead = (await git(['rev-parse', 'HEAD'], { cwd: targetWorkspacePath })).trim();
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

async function isGitWorktree(dir: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, '.git'));
    return true;
  } catch {
    return false;
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
