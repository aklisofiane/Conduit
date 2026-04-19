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
  /** Populated for repo-clone, parallel-branched inherit, and ticket-branch. */
  head?: string;
  /** Populated for repo-clone. */
  branchName?: string;
  /**
   * True when the workspace is a throwaway git worktree owned by this node
   * (e.g. parallel-branched `inherit`). Tells the workflow this worktree
   * should be merged back into its upstream after the parallel group ends.
   */
  isBranchedWorktree?: boolean;
}

export interface WorkspaceResolveInput {
  runId: string;
  nodeName: string;
  spec: WorkspaceSpec;
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
}
