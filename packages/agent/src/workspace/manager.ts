import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkspaceError } from '../errors/index';
import { git } from './git';
import { nodeWorkspacePath, runDir } from './paths';
import { resolveTicketBranchWorkspace } from './ticket-branch';
import type { ResolvedWorkspace, WorkspaceResolveInput } from './types';

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
   */
  async cleanupRun(runId: string): Promise<void> {
    const root = runDir(runId);
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
