import type { RunnerEvent, RunnerRequest } from '@conduit/shared/runner';

/**
 * Abstracts the spawn primitive so the protocol code (orchestrator activity,
 * runner main) stays the same across phases. Phase 1 implementation runs a
 * local Docker container; later phases can dispatch a k8s Job, a gRPC call
 * to a long-lived runner pool, or an in-process child for tests — none of
 * which require changes to the orchestrator activity above the spawner.
 */
export interface RunnerSpawner {
  spawn(req: RunnerRequest, signal: AbortSignal): Promise<RunnerHandle>;
}

export interface RunnerHandle {
  /** Stream of `RunnerEvent`s from the runner. Ends after a terminal `exit`. */
  readonly events: AsyncIterable<RunnerEvent>;
  /**
   * Force-stop the runner. Idempotent — safe to call after the runner has
   * exited on its own. Returns when the runner has fully torn down (process
   * exited, container removed) so the orchestrator can sequence cleanup.
   */
  cancel(): Promise<void>;
}
