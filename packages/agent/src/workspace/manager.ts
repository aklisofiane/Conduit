import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkspaceError } from '../errors/index';
import { git } from './git';
import { nodeWorkspacePath, runDir } from './paths';
import { resolveTicketBranchWorkspace } from './ticket-branch';
import type { ResolvedWorkspace, WorkspaceResolveInput } from './types';

/** Regex for the `gitdir:` line in a worktree's `.git` pointer file. */
const GITDIR_POINTER_RE = /^gitdir:\s*(.+?)\s*$/m;

/**
 * Resolves a workspace spec into a concrete on-disk path. Two arms:
 *
 *   - `ticket-branch` — entry kind. Issue triggers derive a persistent
 *                       `conduit/<id>-<slug>` branch; PR triggers anchor
 *                       directly on `pr.headRef`.
 *   - `inherit`       — sequential pass-through of the upstream worktree,
 *                       or a branched detached worktree off the upstream
 *                       HEAD when this node is one of several siblings
 *                       fanning out from the same upstream.
 */
export class WorkspaceManager {
  async resolve(input: WorkspaceResolveInput): Promise<ResolvedWorkspace> {
    const { spec, runId, nodeName } = input;
    switch (spec.kind) {
      case 'inherit': {
        if (!input.upstreamPath) {
          throw new WorkspaceError(
            `inherit workspace requires upstream path for node "${nodeName}"`,
          );
        }
        if (input.parallelBranch) {
          return this.inheritBranched(runId, nodeName, input.upstreamPath, input.upstreamHead);
        }
        return { path: input.upstreamPath, kind: 'inherit' };
      }
      case 'ticket-branch': {
        if (!input.connection) {
          throw new WorkspaceError(
            `ticket-branch workspace requires a connection for node "${nodeName}"`,
          );
        }
        // PR-anchored runs land on `pr.headRef` and skip the TicketBranch
        // row entirely — neither `ticket` nor `ticketBranchStore` is required.
        // Issue-anchored runs still need both for slug derivation + row upsert.
        if (!input.pr) {
          if (!input.ticket) {
            throw new WorkspaceError(
              `ticket-branch workspace on node "${nodeName}" requires a trigger that carries an issue/PR identifier`,
            );
          }
          if (!input.ticketBranchStore) {
            throw new WorkspaceError(
              `ticket-branch workspace on node "${nodeName}" requires a TicketBranchStore`,
            );
          }
        }
        return resolveTicketBranchWorkspace({
          runId,
          nodeName,
          connection: input.connection,
          ticket: input.ticket,
          store: input.ticketBranchStore,
          pr: input.pr,
        });
      }
      default: {
        const _exhaustive: never = spec;
        throw new WorkspaceError(`Unknown workspace kind: ${String(_exhaustive)}`);
      }
    }
  }

  /**
   * Delete the per-run workspace tree. Best-effort — cleanup failures are
   * logged upstream and don't surface to the user. Base clones are preserved.
   *
   * Worktrees are unregistered from their bare clones *before* the directory
   * is wiped. Skipping that step leaves an orphan `<bare>/worktrees/<name>`
   * entry that pins the branch — the next run that tries to check out the
   * same branch fails with "already used by worktree at <old-run-path>",
   * even after `git worktree prune` (prune ignores entries whose dir still
   * exists, and our `fs.rm` would happen too late to convert this one into
   * an orphan it would clean up).
   */
  async cleanupRun(runId: string): Promise<void> {
    const root = runDir(runId);
    await unregisterRunWorktrees(root);
    await fs.rm(root, { recursive: true, force: true });
  }

  /**
   * Parallel-fan-out `inherit`: create a detached worktree at the upstream's
   * HEAD so this sibling edits in isolation. The workflow later merges the
   * branched worktree back into the upstream via `mergeWorktreeActivity`.
   *
   * The worktree sits next to the upstream's `.git` dir — that's what makes
   * a subsequent `git worktree add` work, since `upstreamPath` itself is
   * a worktree (not a bare repo) and shares the same git dir.
   */
  private async inheritBranched(
    runId: string,
    nodeName: string,
    upstreamPath: string,
    upstreamHead: string | undefined,
  ): Promise<ResolvedWorkspace> {
    const target = nodeWorkspacePath(runId, nodeName);
    await fs.mkdir(path.dirname(target), { recursive: true });

    // Idempotency under Temporal retries: a previous attempt may have
    // created the worktree before the activity errored. Drop registration
    // and any stranded directory before re-adding. `--force` alone won't
    // cover an existing-but-not-registered directory, so the explicit
    // fs.rm is load-bearing.

    await git(['worktree', 'remove', '--force', target], { cwd: upstreamPath }).catch(
      () => undefined,
    );
    await git(['worktree', 'prune'], { cwd: upstreamPath }).catch(() => undefined);
    await fs.rm(target, { recursive: true, force: true });

    const ref = upstreamHead ?? (await git(['rev-parse', 'HEAD'], { cwd: upstreamPath })).trim();
    await git(['worktree', 'add', '--detach', target, ref], { cwd: upstreamPath });
    return {
      path: target,
      kind: 'inherit',
      head: ref,
      isBranchedWorktree: true,
    };
  }
}

/**
 * For every worktree directory directly under `<root>` (the run dir), force-
 * remove its registration from the owning bare clone, then prune each bare
 * clone once. Non-worktree siblings (`.credential-helpers/`, fresh-tmpdir
 * dirs, etc.) are skipped silently — they don't carry git metadata to leak.
 */
async function unregisterRunWorktrees(root: string): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  const bareClones = new Set<string>();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const workspacePath = path.join(root, entry.name);
    const bare = await readBareCloneFromWorktree(workspacePath);
    if (!bare) continue;
    bareClones.add(bare);
    await git(['worktree', 'remove', '--force', workspacePath], { cwd: bare }).catch(
      () => undefined,
    );
  }
  for (const bare of bareClones) {
    await git(['worktree', 'prune'], { cwd: bare }).catch(() => undefined);
  }
}

/**
 * A worktree's `.git` is a pointer file like:
 *   `gitdir: /path/to/<bare>.git/worktrees/<name>`
 * Strip the `/worktrees/<name>` suffix to get the bare clone. Returns null
 * for anything that isn't a worktree (no `.git` file, or a `.git` dir).
 */
async function readBareCloneFromWorktree(workspacePath: string): Promise<string | null> {
  try {
    const pointer = await fs.readFile(path.join(workspacePath, '.git'), 'utf8');
    const match = pointer.match(GITDIR_POINTER_RE);
    const gitdir = match?.[1];
    if (!gitdir) return null;
    const idx = gitdir.indexOf('/worktrees/');
    if (idx === -1) return null;
    return gitdir.slice(0, idx);
  } catch {
    return null;
  }
}
