import { LocalDockerSpawner } from './local-docker';
import type { RunnerSpawner } from './spawner';

/**
 * Pick the runner-spawner implementation. Phase 1 has exactly one: the
 * local-Docker spawner. The indirection exists so worker-package unit
 * tests can swap in a fully scripted spawner via `setRunnerSpawnerForTest`,
 * and so phase 3 (k8s Jobs) can plug in a different concrete spawner
 * without touching the orchestrator activity.
 *
 * Note: there is **no** non-Docker production or e2e path. The spec is
 * explicit that Docker is the only execution mode — anything that
 * bypasses the container also bypasses the trust boundary. E2e tests
 * exercise the real `agent-runner` image; that's what makes them e2e.
 */
let override: RunnerSpawner | null = null;

export function resolveRunnerSpawner(): RunnerSpawner {
  if (override) return override;
  return new LocalDockerSpawner({ image: runnerImageTag() });
}

/** Test hook — overrides the spawner used by `runAgentNode`. */
export function setRunnerSpawnerForTest(spawner: RunnerSpawner | null): void {
  override = spawner;
}

/**
 * Resolve the agent-runner image tag. CI sets `CONDUIT_RUNNER_IMAGE` to the
 * git-sha-tagged image; local dev defaults to `agent-runner:dev` built by
 * `npm run docker:agent-runner:build`.
 */
export function runnerImageTag(): string {
  return process.env.CONDUIT_RUNNER_IMAGE ?? 'agent-runner:dev';
}
