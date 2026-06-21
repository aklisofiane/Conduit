import {
  git,
  GitError,
  mergeBranchedWorktree,
  MergeConflictError,
  touchWorktreeHeartbeat,
} from '@conduit/agent';
import { writeSystemLog } from '../runtime/log-writer';

export interface MergeWorktreeInput {
  runId: string;
  /** Tenant scope — copied from the loaded graph onto every log row this activity writes. */
  orgId: string;
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
 * Uncommitted source work is snapshotted into a single commit so the
 * squash-merge in `mergeBranchedWorktree` has something to operate on.
 * `.conduit/` is stripped on the target side — see merge.ts.
 */
export async function mergeWorktreeActivity(input: MergeWorktreeInput): Promise<void> {
  const { runId, orgId, sourceWorkspacePath, targetWorkspacePath, sourceNodeName, targetNodeName } = input;
  const log = (body: string, level?: 'WARN' | 'ERROR') =>
    writeSystemLog(runId, orgId, targetNodeName, `merge ${sourceNodeName} → ${targetNodeName}: ${body}`, level);

  // Keep the target worktree's liveness heartbeat fresh — merges run between
  // node sessions, outside the run-agent-node heartbeater, and a concurrent
  // same-branch resolve must not treat this gap as a dead owner.
  await touchWorktreeHeartbeat(targetWorkspacePath);

  // Bail cleanly if source isn't a git tree (e.g. fresh tmpdir).
  try {
    await git(['rev-parse', '--is-inside-work-tree'], { cwd: sourceWorkspacePath });
  } catch (err) {
    if (err instanceof GitError) return;
    throw err;
  }

  // Plain `git add -A` (no pathspec) silently respects the source repo's
  // .gitignore. We can't pathspec-exclude `.conduit/` because git errors
  // when an explicit pathspec names an ignored path. If the source repo
  // doesn't gitignore `.conduit/`, the snapshot will briefly contain it —
  // the target-side squash strips it before committing.
  try {
    await git(['add', '-A'], { cwd: sourceWorkspacePath });
  } catch (err) {
    if (err instanceof GitError) await log(`git add -A failed: ${err.stderr.trim()}`, 'ERROR');
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
        `Conduit: ${sourceNodeName} snapshot`,
      ],
      { cwd: sourceWorkspacePath },
    );
  }

  const [sourceHead, targetHead] = await Promise.all([
    git(['rev-parse', 'HEAD'], { cwd: sourceWorkspacePath }).then((s) => s.trim()),
    git(['rev-parse', 'HEAD'], { cwd: targetWorkspacePath }).then((s) => s.trim()),
  ]);
  if (sourceHead === targetHead) {
    await log('no new commits, skipping');
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
      orgId,
      targetNodeName,
      `merged ${sourceNodeName} (${sourceHead.slice(0, 7)}) into ${targetNodeName}`,
    );
  } catch (err) {
    if (err instanceof MergeConflictError) {
      await writeSystemLog(
        runId,
        orgId,
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
