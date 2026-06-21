/**
 * Typed errors raised by the agent runtime. Temporal's retry policy uses
 * these constructor names as the non-retryable classification (see
 * docs/RELIABILITY.md — `nonRetryableErrorTypes`).
 */

export class ValidationError extends Error {
  override readonly name = 'ValidationError';
  constructor(message: string) {
    super(message);
  }
}

export class ConstraintExceededError extends Error {
  override readonly name = 'ConstraintExceededError';
  constructor(
    public readonly constraint: 'maxTurns' | 'maxTokens' | 'maxToolCalls' | 'timeoutSec',
    public readonly limit: number,
    public readonly observed: number,
  ) {
    super(`Agent constraint ${constraint} exceeded: observed ${observed}, limit ${limit}`);
  }
}

export class UnauthorizedError extends Error {
  override readonly name = 'UnauthorizedError';
  constructor(message: string) {
    super(message);
  }
}

export class WorkspaceError extends Error {
  override readonly name = 'WorkspaceError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Raised when a worktree can't be resolved because another *live* run holds
 * the same ticket-branch — its `<worktree>/.conduit/.heartbeat` is fresh, so
 * evicting it would destroy a running agent's working directory. Carries the
 * branch and the owning worktree path so the wait loop and logs can report
 * exactly what's blocking. The resolver throws fast (no internal wait); the
 * activity owns the bounded retry window.
 */
export class BranchBusyError extends Error {
  override readonly name = 'BranchBusyError';
  constructor(
    public readonly branchName: string,
    public readonly ownerPath: string,
  ) {
    super(
      `Branch "${branchName}" is in use by a live worktree at ${ownerPath} — its heartbeat is fresh, so it was not evicted.`,
    );
  }
}
