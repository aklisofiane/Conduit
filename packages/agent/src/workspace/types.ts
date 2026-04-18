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
  /** Populated for repo-clone / ticket-branch. */
  head?: string;
  /** Populated for repo-clone. */
  branchName?: string;
}

export interface WorkspaceResolveInput {
  runId: string;
  nodeName: string;
  spec: WorkspaceSpec;
  connection?: ConnectionContext;
  /** Populated for `inherit` — the upstream node's resolved workspace path. */
  upstreamPath?: string;
}
