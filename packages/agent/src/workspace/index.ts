export { WorkspaceManager } from './manager';
export type {
  ConnectionContext,
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
