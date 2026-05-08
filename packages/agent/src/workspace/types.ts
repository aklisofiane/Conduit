import type { WorkspaceSpec } from '@conduit/shared';

export type { WorkspaceSpec };

/**
 * Connection snapshot the workspace manager needs for a clone. Fields are
 * the bare minimum — owner/repo + the clone URL and auth token. Keeping
 * this small so the API/worker can pass it without leaking DB shapes.
 */
export interface ConnectionContext {
  id: string;
  platform: 'github' | 'gitlab';
  owner: string;
  repo: string;
  /** https://github.com/<owner>/<repo>.git — token never included. */
  cloneUrl: string;
  /** Platform access token used only for fetch/clone; stripped from remote afterward. */
  token?: string;
}

export interface ResolvedWorkspace {
  /** Absolute path the agent's CWD should be set to. */
  path: string;
  kind: WorkspaceSpec['kind'];
  /** Populated for parallel-branched inherit and ticket-branch. */
  head?: string;
  /** Populated for ticket-branch. */
  branchName?: string;
  /**
   * True when the workspace is a throwaway git worktree owned by this node
   * (e.g. parallel-branched `inherit`). Tells the workflow this worktree
   * should be merged back into its upstream after the parallel group ends.
   */
  isBranchedWorktree?: boolean;
  /** Populated for ticket-branch — the `TicketBranch` row id. */
  ticketBranchId?: string;
  /**
   * True when the remote branch existed before this run (i.e. iteration N+1
   * resumed a branch iteration N created). False on the first run for a ticket.
   * Used by the cleanup activity for the unpushed-commits warning.
   */
  remoteBranchExisted?: boolean;
}

export interface WorkspaceResolveInput {
  runId: string;
  nodeName: string;
  spec: WorkspaceSpec;
  /**
   * Tenant scope — the workspace manager forwards this onto the
   * `TicketBranchStore.upsert` call so the row's unique key is
   * `(orgId, platform, owner, repo, ticketId)`. Required when
   * `spec.kind === 'ticket-branch'` and the run is issue-anchored
   * (PR-anchored runs skip the row entirely).
   */
  orgId?: string;
  connection?: ConnectionContext;
  /** Populated for `inherit` — the upstream node's resolved workspace path. */
  upstreamPath?: string;
  /**
   * Populated for `inherit` when the node runs in a parallel fan-out group
   * (multiple siblings inheriting from the same upstream). The manager adds
   * a detached throwaway worktree off this commit so siblings don't stomp
   * on each other's files. Sequential `inherit` ignores this.
   */
  upstreamHead?: string;
  /**
   * When true, `inherit` is resolved as a branched worktree off the upstream
   * HEAD rather than a passthrough of the upstream path. Set by the workflow
   * when the group size > 1.
   */
  parallelBranch?: boolean;
  /**
   * Populated for `ticket-branch`. Identifies the ticket the branch is
   * scoped to — `id` is the user-visible key (issue number / Jira key),
   * `title` seeds the slug on first create.
   */
  ticket?: TicketContext;
  /** Populated for `ticket-branch`. Lets the manager look up / create the `TicketBranch` row. */
  ticketBranchStore?: TicketBranchStore;
  /**
   * Populated for `ticket-branch` when the trigger is a PR event. Tells the
   * resolver to land directly on `pr.headRef` instead of deriving a
   * `conduit/<id>-<slug>` branch — Conduit-internal flows naturally land on
   * the same branch the upstream Worker pushed; external PRs land on
   * whatever ref the contributor opened the PR from. Skips the
   * `TicketBranch` row upsert (no row created for PR-anchored runs).
   */
  pr?: PrContext;
}

/** Ticket identity passed into `ticket-branch` resolution. */
export interface TicketContext {
  /** User-visible identifier as a string ("42" for GitHub, "PROJ-123" for Jira). */
  id: string;
  /** Ticket title — seeds the slug on *first* creation only. */
  title: string;
}

/** PR identity passed into `ticket-branch` resolution for PR-anchored runs. */
export interface PrContext {
  /** PR head branch name (e.g. `conduit/42-fix-login`, or arbitrary for external PRs). */
  headRef: string;
  /** PR base branch — informational; resolver doesn't need it for the worktree add. */
  baseRef: string;
  /** Populated only when the head lives in a different (forked) repo. */
  headRepo?: { owner: string; name: string };
}

/** Row-shaped view of a `TicketBranch` DB entry — see `packages/database`. */
export interface TicketBranchRow {
  id: string;
  platform: ConnectionContext['platform'];
  owner: string;
  repo: string;
  ticketId: string;
  slug: string;
  branchName: string;
  baseRef: string | null;
}

/**
 * Adapter around the `TicketBranch` Prisma model. Lives outside
 * `@conduit/agent` (implemented in `apps/worker/src/runtime`) so this
 * package stays DB-agnostic.
 *
 * Semantics: `upsert` is idempotent — on the first call for a ticket it
 * derives the slug from `ticketTitle` and persists `baseRef`; subsequent
 * calls return the existing row verbatim so branch name + base stay
 * stable across workflows (Worker + Critic converge on one row).
 */
export interface TicketBranchStore {
  upsert(input: {
    /**
     * Tenant scope — the Prisma row's unique key is
     * `(orgId, platform, owner, repo, ticketId)`, so two orgs with
     * overlapping Github coords stay isolated. Within an org, Worker +
     * Critic on the same ticket still converge on one row.
     */
    orgId: string;
    platform: ConnectionContext['platform'];
    owner: string;
    repo: string;
    ticketId: string;
    ticketTitle: string;
    baseRef: string;
  }): Promise<TicketBranchRow>;
  markRunStart(id: string): Promise<void>;
}
