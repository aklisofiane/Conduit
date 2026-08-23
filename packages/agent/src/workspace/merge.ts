import fs from 'node:fs/promises';
import path from 'node:path';
import { CONDUIT_DIR, clearConduitFolder, isNotFound } from './conduit-folder';
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
 * `.conduit/` files target had *before* the merge (e.g. cloneConduitFolder's
 * copy of the upstream's own summary) are preserved on the working tree so
 * downstream nodes can still read them. Target's `.conduit/` is briefly
 * cleared so the squash doesn't trip git's untracked-overwrite preflight
 * when the same path appears in source's snapshot.
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

  // Snapshot the basenames target had under `.conduit/` so the post-strip
  // step can preserve them on the WT. Then clear the directory so the
  // squash can write through without hitting the untracked-overwrite
  // preflight. On a real conflict we lose target's `.conduit/`, but the
  // run fails and the workspace is torn down anyway.
  const conduitDir = path.join(targetWorkspacePath, CONDUIT_DIR);
  const existedBefore = new Set<string>(
    await fs.readdir(conduitDir).catch((err: unknown) => {
      if (isNotFound(err)) return [] as string[];
      throw err;
    }),
  );
  await clearConduitFolder(targetWorkspacePath);

  try {
    await git(['merge', '--squash', sourceRef], { cwd: targetWorkspacePath });

    // Capture `.conduit/*` paths the squash staged so we can drop them from
    // both the index and the working tree. Files whose basenames were in
    // target's pre-merge `.conduit/` are spared on the WT side — they're
    // target's own (typically the upstream's summary copied in by
    // cloneConduitFolder) and downstream nodes still need them.
    const stagedConduit = (
      await git(['diff', '--cached', '--name-only', '--', CONDUIT_DIR], {
        cwd: targetWorkspacePath,
      })
    )
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    await git(['rm', '-rf', '--cached', '--ignore-unmatch', '--', CONDUIT_DIR], {
      cwd: targetWorkspacePath,
    });
    for (const relPath of stagedConduit) {
      if (existedBefore.has(path.basename(relPath))) continue;
      await fs.rm(path.join(targetWorkspacePath, relPath), { force: true });
    }
    // rmdir throws ENOTEMPTY if target's preserved files remain — swallowed.
    if (stagedConduit.length > 0) {
      await fs.rmdir(conduitDir).catch(() => undefined);
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
      ['-c', 'user.email=conduit@local', '-c', 'user.name=Conduit', 'commit', '-m', message],
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
