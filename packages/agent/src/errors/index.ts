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
