import fs from 'node:fs/promises';
import path from 'node:path';
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
 * Merge a parallel-branched worktree back into the upstream worktree using a
 * squash-merge: source's per-commit history never enters target, and we
 * strip `.conduit/` from the staged tree before committing so neither
 * target's tip nor target's history carries any `.conduit/` paths the agent
 * may have committed during its session.
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
    await git(['merge', '--squash', sourceRef], { cwd: targetWorkspacePath });

    // Capture `.conduit/*` paths the squash staged so we can drop them from
    // both the index and the working tree. Target's pre-existing `.conduit/`
    // files (e.g. summaries from earlier copy-conduit-files runs) are
    // untracked & gitignored and won't appear in `--cached`, so they're
    // preserved.
    const stagedConduit = (
      await git(['diff', '--cached', '--name-only', '--', '.conduit'], {
        cwd: targetWorkspacePath,
      })
    )
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    await git(['rm', '-rf', '--cached', '--ignore-unmatch', '--', '.conduit'], {
      cwd: targetWorkspacePath,
    });
    for (const relPath of stagedConduit) {
      await fs.rm(path.join(targetWorkspacePath, relPath), { force: true });
    }
    // Drop the `.conduit/` directory itself if removing the staged files
    // emptied it; rmdir silently no-ops when target had its own files there.
    if (stagedConduit.length > 0) {
      await fs.rmdir(path.join(targetWorkspacePath, '.conduit')).catch(() => undefined);
    }

    // If the only diff was `.conduit/`, scrubbing leaves the index clean;
    // skip the commit so target's HEAD doesn't churn for runtime-only state.
    try {
      await git(['diff', '--cached', '--quiet'], { cwd: targetWorkspacePath });
      return;
    } catch {
      // staged changes exist; fall through to commit
    }
    await git(
      [
        '-c',
        'user.email=conduit@local',
        '-c',
        'user.name=Conduit',
        'commit',
        '-m',
        message,
      ],
      { cwd: targetWorkspacePath },
    );
  } catch (err) {
    if (!(err instanceof GitError)) throw err;
    const conflicts = await conflictedFiles(targetWorkspacePath);
    // --squash leaves a partial state on conflict (no MERGE_HEAD, so
    // `git merge --abort` doesn't apply); reset clears it.
    await git(['reset', '--hard', 'HEAD'], { cwd: targetWorkspacePath }).catch(() => undefined);
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
