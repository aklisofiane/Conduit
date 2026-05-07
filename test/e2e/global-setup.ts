import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { composeDown, composeUp, resetTestDatabase } from './stack';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Vitest globalSetup hook for the `e2e` project. Runs once per test run:
 *   1. docker compose -f docker-compose.test.yml up -d --wait
 *   2. prisma db push --force-reset against the test DB
 *   3. docker build the agent-runner image (so `agent-runner:dev` exists
 *      for the worker to spawn). Layer-cached after the first build.
 *
 * The returned function runs on suite shutdown and tears the stack down.
 *
 * Skip the teardown (compose stays up between runs) by setting
 * `CONDUIT_TEST_KEEP_STACK=1` — useful for iteration during development.
 * Skip the runner image rebuild (assume `agent-runner:dev` already exists)
 * with `CONDUIT_TEST_SKIP_RUNNER_BUILD=1`.
 */
export default async function setup(): Promise<() => Promise<void>> {
  composeUp();
  resetTestDatabase();
  if (process.env.CONDUIT_TEST_SKIP_RUNNER_BUILD !== '1') {
    buildAgentRunnerImage();
  }
  return async () => {
    if (process.env.CONDUIT_TEST_KEEP_STACK === '1') return;
    composeDown();
  };
}

function buildAgentRunnerImage(): void {
  const res = spawnSync(
    'docker',
    [
      'build',
      '-t',
      process.env.CONDUIT_RUNNER_IMAGE ?? 'agent-runner:dev',
      '-f',
      'apps/agent-runner/Dockerfile',
      '.',
    ],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );
  if (res.status !== 0) {
    throw new Error(`agent-runner image build failed (exit ${res.status})`);
  }
}
