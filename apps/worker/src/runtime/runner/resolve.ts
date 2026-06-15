import { LocalDockerSpawner } from './local-docker';
import { LocalProcessSpawner } from './local-process';
import { resolveRunnerMode } from './mode';
import type { RunnerSpawner } from './spawner';

/**
 * Pick the runner-spawner implementation by runner mode (see `mode.ts`):
 * Docker containers when `docker`, detached host processes when `host`.
 * The indirection also lets worker-package unit tests swap in a fully
 * scripted spawner via `setRunnerSpawnerForTest`, and leaves room for a
 * k8s-Jobs spawner to plug in without touching the orchestrator activity.
 *
 * Note: there is **no** non-Docker path when `CONDUIT_DEPLOYMENT=hosted` —
 * anything that bypasses the container also bypasses the trust boundary,
 * and `resolveRunnerMode` refuses to boot `hosted`+`host`. Host mode is a
 * local-deployment affordance: the agent acts as the user on the user's
 * own machine. E2e tests pin `CONDUIT_RUNNER_MODE=docker` and exercise the
 * real `agent-runner` image; that's what makes them e2e.
 */
let override: RunnerSpawner | null = null;

export function resolveRunnerSpawner(): RunnerSpawner {
  if (override) return override;
  if (resolveRunnerMode() === 'host') return new LocalProcessSpawner();
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
