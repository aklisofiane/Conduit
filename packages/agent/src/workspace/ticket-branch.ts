import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkspaceError } from '../errors/index';
import { git, GitError } from './git';
import { withPathLock } from './lock';
import { baseClonePath, nodeWorkspacePath } from './paths';
import { dropConflictingWorktrees } from './worktree-cleanup';
import type {
  ConnectionContext,
  PrContext,
  ResolvedWorkspace,
  TicketBranchStore,
  TicketContext,
} from './types';

export interface TicketBranchResolveInput {
  runId: string;
  nodeName: string;
  connection: ConnectionContext;
  /**
   * Tenant scope used for the `TicketBranch` row's unique key
   * `(orgId, platform, owner, repo, ticketId)`. Required for issue-anchored
   * runs; absent on PR-anchored runs (no row gets written).
   */
  orgId?: string;
  /** Required for issue-anchored runs; absent on PR-anchored runs. */
  ticket?: TicketContext;
  /** Required for issue-anchored runs; absent on PR-anchored runs. */
  store?: TicketBranchStore;
  /** Populated for PR-anchored runs — short-circuits row upsert + slug derivation. */
  pr?: PrContext;
}

/**
 * Resolve a `ticket-branch` workspace:
 *
 *   1. Take the base-clone mutex — serializes concurrent worktree adds from
 *      retries or cross-workflow races on the same ticket/repo.
 *   2. Ensure the base bare clone exists and is up-to-date.
 *   3. Upsert the `TicketBranch` row (first call derives the slug; later
 *      calls read it back verbatim). Row is shared across workflows via the
 *      unique `(platform, owner, repo, ticketId)` key.
 *   4. Check the remote for the branch:
 *        - exists  → `git worktree add <target> <branch>` so the worktree
 *                    tracks the remote branch and iteration N+1 sees
 *                    iteration N's commits.
 *        - missing → `git worktree add -b <branch> <target> <baseRef>`
 *                    off the cached row's base (or the freshly-resolved
 *                    default branch on first-ever create).
 *   5. Clean the remote URL of any auth so `git remote -v` is tidy; push
 *      auth is supplied at run time by `installPushCredentials` via a
 *      per-run env var + credential helper.
 *
 * Idempotent under Temporal retries: a retry lands back at step 1, the lock
 * queues behind any in-flight resolve, and the upsert/add sequence re-does
 * the exact same work. If the worktree dir already exists from a partial
 * previous attempt, we fall back to registering it in-place.
 */
export async function resolveTicketBranchWorkspace(
  input: TicketBranchResolveInput,
): Promise<ResolvedWorkspace> {
  const { runId, nodeName, connection, orgId, ticket, store, pr } = input;
  const bare = baseClonePath(connection.platform, connection.host, connection.owner, connection.repo);
  const target = nodeWorkspacePath(runId, nodeName);

  if (!pr && (!ticket || !store || !orgId)) {
    // Defensive — `WorkspaceManager` validates this earlier, but the resolver
    // is exported and might be called from another path.
    throw new WorkspaceError(
      `resolveTicketBranchWorkspace requires either a PR context or an orgId + ticket + TicketBranchStore (node "${nodeName}")`,
    );
  }

  return withPathLock(bare, async () => {
    await ensureBaseClone(bare, connection);
    // Must precede the fetch: if a previous attempt crashed mid-activity,
    // git still thinks that worktree has the branch checked out and refuses
    // ("refusing to fetch into branch X checked out at Y").
    await dropConflictingWorktrees(bare, target);
    // Keep the base clone's mirrored refs fresh so `git worktree add <branch>`
    // can resolve a branch someone else pushed between runs. Fetch uses the
    // tokenized URL so private repos still authenticate.
    await Promise.all([
      fetchWithAuth(bare, connection),
      fs.mkdir(path.dirname(target), { recursive: true }),
    ]);

    if (pr) {
      // PR-anchored: the head ref already exists on the remote (GitHub
      // guarantees it at `pull_request.opened`). No row, no slug — just land
      // on the PR's branch so the agent reviews the same commits the human
      // is reviewing on github.com.
      await addTrackingWorktree(bare, target, pr.headRef);
      await stripRemoteAuth(target, connection.cloneUrl);
      const head = (await git(['rev-parse', 'HEAD'], { cwd: target })).trim();
      return {
        path: target,
        kind: 'ticket-branch',
        head,
        branchName: pr.headRef,
        remoteBranchExisted: true,
      };
    }

    // Issue-anchored — derive `conduit/<id>-<slug>`, upsert the row,
    // create-or-track the branch off the repo's default branch.
    const baseRef = await defaultBranch(bare);
    const row = await store!.upsert({
      orgId: orgId!,
      platform: connection.platform,
      hostUrl: connection.host,
      owner: connection.owner,
      repo: connection.repo,
      ticketId: ticket!.id,
      ticketTitle: ticket!.title,
      baseRef,
    });

    const branchName = row.branchName;

    const remoteExists = await remoteBranchExists(bare, branchName);
    if (remoteExists) {
      await addTrackingWorktree(bare, target, branchName);
    } else {
      await createTrackingWorktree(bare, target, branchName, row.baseRef ?? baseRef);
    }

    await stripRemoteAuth(target, connection.cloneUrl);

    const head = (await git(['rev-parse', 'HEAD'], { cwd: target })).trim();

    return {
      path: target,
      kind: 'ticket-branch',
      head,
      branchName,
      ticketBranchId: row.id,
      remoteBranchExisted: remoteExists,
    };
  });
}

async function ensureBaseClone(bare: string, connection: ConnectionContext): Promise<void> {
  const head = path.join(bare, 'HEAD');
  try {
    await fs.access(head);
    return;
  } catch {
    // fall through to clone
  }
  await fs.mkdir(path.dirname(bare), { recursive: true });
  const url = withTokenUrl(connection);
  await git(['clone', '--bare', url, bare]);
  await git(['remote', 'set-url', 'origin', connection.cloneUrl], { cwd: bare }).catch(() => undefined);
}

async function fetchWithAuth(bare: string, connection: ConnectionContext): Promise<void> {
  // The base clone's stored remote URL is cleaned, so we inject a tokenized
  // URL at fetch time. Falls back to the stored URL for public repos with no token.
  if (!connection.token) {
    await git(['fetch', '--prune', 'origin'], { cwd: bare });
    return;
  }
  const tokenized = withTokenUrl(connection);
  // `fetch <url> <refspec>` fetches without mutating the stored remote URL.
  // Bare clones mirror `refs/heads/*:refs/heads/*` by default — replicate here.
  await git(
    ['fetch', '--prune', tokenized, '+refs/heads/*:refs/heads/*'],
    { cwd: bare },
  );
}

async function remoteBranchExists(bare: string, branchName: string): Promise<boolean> {
  // Bare clones mirror remote heads into `refs/heads/*` — an existing ref
  // means the branch is on the remote (we just fetched). Use `show-ref`
  // instead of `ls-remote` to stay offline and avoid re-hitting auth.
  try {
    const out = await git(['show-ref', '--verify', `refs/heads/${branchName}`], {
      cwd: bare,
    });
    return out.trim().length > 0;
  } catch (err) {
    if (err instanceof GitError) return false;
    throw err;
  }
}

async function addTrackingWorktree(
  bare: string,
  target: string,
  branchName: string,
): Promise<void> {
  try {
    await git(['worktree', 'add', '--force', target, branchName], { cwd: bare });
  } catch (err) {
    if (!(err instanceof GitError)) throw err;
    throw new WorkspaceError(
      `git worktree add ${branchName} into ${target} failed: ${err.stderr.trim()}`,
    );
  }
}

async function createTrackingWorktree(
  bare: string,
  target: string,
  branchName: string,
  baseRef: string,
): Promise<void> {
  try {
    await git(['worktree', 'add', '-b', branchName, target, baseRef], { cwd: bare });
    return;
  } catch (err) {
    if (!(err instanceof GitError)) throw err;
    // Retry uses `--force -B` because the failed `add -b` creates the branch
    // ref at `<baseRef>` before bailing; a stale loose ref from a crashed
    // run can be in the same shape. Reset is safe — the caller confirmed
    // the branch doesn't exist on the remote, so a local-only ref is data
    // we can't recover regardless.
    try {
      await dropConflictingWorktrees(bare, target, branchName);
      await git(['worktree', 'add', '--force', '-B', branchName, target, baseRef], {
        cwd: bare,
      });
    } catch (recoveryErr) {
      const recoveryStderr =
        recoveryErr instanceof GitError ? recoveryErr.stderr.trim() : String(recoveryErr);
      throw new WorkspaceError(
        `git worktree add -b ${branchName} from ${baseRef} failed: ${err.stderr.trim()}; recovery: ${recoveryStderr}`,
      );
    }
  }
}

async function stripRemoteAuth(worktreePath: string, cleanUrl: string): Promise<void> {
  await git(['remote', 'set-url', 'origin', cleanUrl], { cwd: worktreePath }).catch(
    () => undefined,
  );
}

async function defaultBranch(bare: string): Promise<string> {
  const out = await git(['symbolic-ref', '--short', 'HEAD'], { cwd: bare }).catch(() => '');
  return out.trim() || 'main';
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
