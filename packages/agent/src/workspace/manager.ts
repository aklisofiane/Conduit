import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkspaceError } from '../errors/index';
import { git } from './git';
import { nodeWorkspacePath, runDir } from './paths';
import { resolveTicketBranchWorkspace } from './ticket-branch';
import type { ResolvedWorkspace, WorkspaceResolveInput } from './types';
import { dropConflictingWorktrees } from './worktree-cleanup';

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
   * Best-effort delete of the per-run workspace tree; unregisters worktrees
   * from their owning bare clones first. Base clones are preserved. Cleanup
   * failures are logged upstream and don't surface to the user.
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

    // Idempotency under Temporal retries: a previous attempt may have left
    // a worktree registration and/or a stranded directory at `target`.
    await dropConflictingWorktrees(upstreamPath, target);

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
 * Without this step, `fs.rm`'ing the run dir leaves the bare clone's
 * `<bare>/worktrees/<name>` entry behind, pinning the branch — the next run
 * that tries to check out the same branch fails with "already used by
 * worktree at <old-run-path>". `git worktree prune` doesn't help: it only
 * collects entries whose dir is missing, and we'd be calling it after the
 * `fs.rm`, on a different bare clone with no awareness of the dead entry.
 *
 * Non-worktree siblings (`.credential-helpers/`, tmp dirs, etc.) skip
 * silently — they have no `.git` pointer file to dereference.
 */
async function unregisterRunWorktrees(root: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return;
  }
  const bareClones = new Set(
    (
      await Promise.all(
        entries.map(async (name) => {
          const workspacePath = path.join(root, name);
          const bare = await bareCloneOf(workspacePath);
          if (!bare) return null;
          await git(['worktree', 'remove', '--force', workspacePath], { cwd: bare }).catch(
            () => undefined,
          );
          return bare;
        }),
      )
    ).filter((b): b is string => b !== null),
  );
  await Promise.all(
    [...bareClones].map((bare) =>
      git(['worktree', 'prune'], { cwd: bare }).catch(() => undefined),
    ),
  );
}

/**
 * Read the bare clone owning `workspacePath` from its `.git` pointer file:
 *   `gitdir: <bare>/worktrees/<name>`
 * Returns null for non-worktree dirs (no `.git` pointer, `.git` is a dir,
 * or no `/worktrees/` segment).
 */
async function bareCloneOf(workspacePath: string): Promise<string | null> {
  const pointer = await fs
    .readFile(path.join(workspacePath, '.git'), 'utf8')
    .catch(() => null);
  const gitdir = pointer?.match(/^gitdir:\s*(.+?)\s*$/m)?.[1];
  const idx = gitdir?.indexOf('/worktrees/') ?? -1;
  return idx === -1 ? null : gitdir!.slice(0, idx);
}
