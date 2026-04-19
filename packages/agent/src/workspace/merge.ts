import { git, GitError } from './git';

export class MergeConflictError extends Error {
  override readonly name = 'MergeConflictError';
  constructor(
    public readonly targetPath: string,
    public readonly sourceRef: string,
    public readonly conflicts: string[],
    cause?: string,
  ) {
    super(
      `Merge from ${sourceRef} into ${targetPath} hit conflicts in: ${conflicts.join(', ') || '(unknown)'}${
        cause ? ` — ${cause}` : ''
      }`,
    );
  }
}

/**
 * Merge a parallel-branched worktree back into the upstream worktree. First
 * attempts a non-fast-forward `git merge` without invoking an editor; on
 * conflict, aborts the merge and throws `MergeConflictError` carrying the
 * conflicted paths.
 *
 * Phase 3 ships the clean-merge path only. Conflict resolution via a
 * lightweight agent session (see docs/design-docs/agent-execution.md
 * "Merge-back agent") lands in a later phase — the exception is shaped so
 * that future handler can pick up `conflicts` and drive the resolution.
 */
export async function mergeBranchedWorktree(args: {
  targetWorkspacePath: string;
  sourceRef: string;
  sourceNodeName: string;
}): Promise<void> {
  const { targetWorkspacePath, sourceRef, sourceNodeName } = args;
  const message = `Conduit: merge ${sourceNodeName}`;
  try {
    await git(
      ['merge', '--no-edit', '--no-ff', '-m', message, sourceRef],
      { cwd: targetWorkspacePath },
    );
  } catch (err) {
    if (!(err instanceof GitError)) throw err;
    const conflicts = await conflictedFiles(targetWorkspacePath);
    await git(['merge', '--abort'], { cwd: targetWorkspacePath }).catch(() => undefined);
    throw new MergeConflictError(targetWorkspacePath, sourceRef, conflicts, err.stderr.trim());
  }
}

async function conflictedFiles(cwd: string): Promise<string[]> {
  const out = await git(['diff', '--name-only', '--diff-filter=U'], { cwd }).catch(() => '');
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}
