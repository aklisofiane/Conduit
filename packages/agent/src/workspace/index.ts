export { WorkspaceManager, bareCloneOf } from './manager';
export type {
  ConnectionContext,
  PrContext,
  ResolvedWorkspace,
  TicketBranchRow,
  TicketBranchStore,
  TicketContext,
  WorkspaceResolveInput,
  WorkspaceSpec,
} from './types';
export {
  conduitHome,
  runsRoot,
  baseClonesRoot,
  runDir,
  nodeWorkspacePath,
  baseClonePath,
} from './paths';
export {
  CONDUIT_DIR,
  readConduitSummaries,
  readConduitSummary,
  copyConduitSummaries,
  clearConduitFolder,
} from './conduit-folder';
export { git, GitError } from './git';
export { mergeBranchedWorktree, MergeConflictError } from './merge';
export { deriveSlug, formatBranchName } from './slug';
export { withPathLock } from './lock';
export { installPushCredentials } from './push-auth';
export {
  touchWorktreeHeartbeat,
  isWorktreeAlive,
  WORKTREE_HEARTBEAT_INTERVAL_MS,
  WORKTREE_STALE_MS,
} from './worktree-heartbeat';
