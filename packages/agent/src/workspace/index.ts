export { WorkspaceManager } from './manager';
export type {
  ConnectionContext,
  ResolvedWorkspace,
  WorkspaceResolveInput,
  WorkspaceSpec,
} from './types';
export {
  conduitHome,
  runsRoot,
  baseClonesRoot,
  runDir,
  nodeWorkspacePath,
} from './paths';
export {
  readConduitSummaries,
  readConduitSummary,
  copyConduitSummaries,
  clearConduitFolder,
} from './conduit-folder';
export { git, GitError } from './git';
export { mergeBranchedWorktree, MergeConflictError } from './merge';
