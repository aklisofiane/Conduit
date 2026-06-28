import { WorkspaceError } from '../errors/index';
import { parseBaseMarker } from './base-marker';
import {
  addTrackingWorktree,
  createTrackingWorktree,
  defaultBranch,
  remoteBranchExists,
} from './git-helpers';
import { resolveBranchWorkspace } from './resolve-branch';
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
 *        - exists  → `git worktree add -B <branch> <target>
 *                    refs/remotes/origin/<branch>` so the worktree is reset
 *                    to the freshly-fetched remote tip and iteration N+1 sees
 *                    iteration N's commits.
 *        - missing → `git worktree add -b <branch> <target>
 *                    refs/remotes/origin/<baseRef>` off the cached row's base
 *                    (or the freshly-resolved default branch on first-ever
 *                    create).
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

  if (!pr && (!ticket || !store || !orgId)) {
    // Defensive — `WorkspaceManager` validates this earlier, but the resolver
    // is exported and might be called from another path.
    throw new WorkspaceError(
      `resolveTicketBranchWorkspace requires either a PR context or an orgId + ticket + TicketBranchStore (node "${nodeName}")`,
    );
  }

  return resolveBranchWorkspace({
    runId,
    nodeName,
    connection,
    land: async ({ bare, target }) => {
      if (pr) {
        // PR-anchored: the head ref already exists on the remote (GitHub
        // guarantees it at `pull_request.opened`). No row, no slug — just land
        // on the PR's branch so the agent reviews the same commits the human
        // is reviewing on github.com.
        await addTrackingWorktree(bare, target, pr.headRef);
        return { kind: 'ticket-branch', branchName: pr.headRef, remoteBranchExisted: true };
      }

      // Issue-anchored — derive `conduit/<id>-<slug>`, upsert the row,
      // create-or-track the branch off the resolved base. The base defaults to
      // the repo default, but a `<!-- conduit:base=<branch> -->` marker on the
      // issue body overrides it — read-once, only at branch birth (when no row
      // exists yet), so a changed or since-broken marker is inert once the
      // branch exists (`baseRef` is first-create-wins on the row). A marker
      // pointing at a branch that isn't on the remote hard-fails the run rather
      // than silently basing off the default; gating on branch birth keeps that
      // hard-fail from killing an established branch whose base it never uses.
      const repoDefault = await defaultBranch(bare);
      const existing = await store!.find({
        orgId: orgId!,
        platform: connection.platform,
        hostUrl: connection.host,
        owner: connection.owner,
        repo: connection.repo,
        ticketId: ticket!.id,
      });
      let baseRef = existing?.baseRef ?? repoDefault;
      if (!existing) {
        const marked = parseBaseMarker(ticket!.body);
        if (marked && marked !== repoDefault) {
          if (!(await remoteBranchExists(bare, marked))) {
            throw new WorkspaceError(
              `ticket-branch on node "${nodeName}" requested base "${marked}" via a conduit:base marker, but that branch does not exist on the remote`,
            );
          }
          baseRef = marked;
        }
      }
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

      return {
        kind: 'ticket-branch',
        branchName,
        remoteBranchExisted: remoteExists,
        ticketBranchId: row.id,
      };
    },
  });
}
