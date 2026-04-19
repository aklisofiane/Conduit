import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkspaceError } from '../errors/index';
import { git } from './git';
import { baseClonesRoot, nodeWorkspacePath, runDir } from './paths';
import { resolveTicketBranchWorkspace } from './ticket-branch';
import type {
  ConnectionContext,
  ResolvedWorkspace,
  WorkspaceResolveInput,
} from './types';

/**
 * Resolves a workspace spec into a concrete on-disk path. Single entrypoint
 * for all four kinds (`fresh-tmpdir`, `repo-clone`, `inherit`, `ticket-branch`)
 * so `runAgentNode` gets one `resolve()` call without touching git internals.
 */
export class WorkspaceManager {
  async resolve(input: WorkspaceResolveInput): Promise<ResolvedWorkspace> {
    const { spec, runId, nodeName } = input;
    switch (spec.kind) {
      case 'fresh-tmpdir': {
        const dir = nodeWorkspacePath(runId, nodeName);
        await fs.mkdir(dir, { recursive: true });
        return { path: dir, kind: 'fresh-tmpdir' };
      }
      case 'repo-clone': {
        if (!input.connection) {
          throw new WorkspaceError(
            `repo-clone workspace requires a connection for node "${nodeName}"`,
          );
        }
        return this.repoClone(runId, nodeName, input.connection, spec.ref);
      }
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
        return resolveTicketBranchWorkspace({
          runId,
          nodeName,
          spec,
          connection: input.connection,
          ticket: input.ticket,
          store: input.ticketBranchStore,
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

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async repoClone(
    runId: string,
    nodeName: string,
    connection: ConnectionContext,
    ref: string | undefined,
  ): Promise<ResolvedWorkspace> {
    const bare = await this.ensureBaseClone(connection);
    const target = nodeWorkspacePath(runId, nodeName);
    await fs.mkdir(path.dirname(target), { recursive: true });

    // Bring the base clone up-to-date. Uses the bare clone's remote (which
    // already has auth baked in via the credential helper during clone).
    await git(['fetch', '--prune', 'origin'], { cwd: bare });

    // `clone --bare` mirrors remote heads into `refs/heads/*`, so the
    // resolved checkout ref is the branch name itself — no `origin/` prefix
    // (that would only exist for a non-bare clone's remote-tracking refs).
    const checkoutRef = ref ?? (await defaultBranch(bare));
    await git(['worktree', 'add', '--detach', target, checkoutRef], { cwd: bare });

    // Strip tokens from remote URL so the agent's `git remote -v` is clean.
    await git(['remote', 'set-url', 'origin', connection.cloneUrl], { cwd: target }).catch(
      () => undefined,
    );

    const head = (await git(['rev-parse', 'HEAD'], { cwd: target })).trim();
    const branchName = checkoutRef.replace(/^origin\//, '');
    return { path: target, kind: 'repo-clone', head, branchName };
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
    const ref = upstreamHead ?? (await git(['rev-parse', 'HEAD'], { cwd: upstreamPath })).trim();
    await git(['worktree', 'add', '--detach', target, ref], { cwd: upstreamPath });
    return {
      path: target,
      kind: 'inherit',
      head: ref,
      isBranchedWorktree: true,
    };
  }

  private async ensureBaseClone(connection: ConnectionContext): Promise<string> {
    const bare = path.join(
      baseClonesRoot(),
      connection.platform,
      connection.owner,
      `${connection.repo}.git`,
    );
    try {
      await fs.access(path.join(bare, 'HEAD'));
      return bare;
    } catch {
      await fs.mkdir(path.dirname(bare), { recursive: true });
      const url = withTokenUrl(connection);
      await git(['clone', '--bare', url, bare]);
      // Drop the tokenized URL after the bare clone is established.
      await git(['remote', 'set-url', 'origin', connection.cloneUrl], { cwd: bare });
      return bare;
    }
  }
}

function withTokenUrl(connection: ConnectionContext): string {
  if (!connection.token) return connection.cloneUrl;
  try {
    const u = new URL(connection.cloneUrl);
    u.username = 'x-access-token';
    u.password = connection.token;
    return u.toString();
  } catch {
    return connection.cloneUrl;
  }
}

async function defaultBranch(bareDir: string): Promise<string> {
  const out = await git(['symbolic-ref', '--short', 'HEAD'], { cwd: bareDir }).catch(() => '');
  return out.trim() || 'main';
}
