import { composeDown, composeUp, resetTestDatabase } from './stack';

/**
 * Vitest globalSetup hook for the `e2e` project. Runs once per test run:
 *   1. docker compose -f docker-compose.test.yml up -d --wait
 *   2. prisma db push --force-reset against the test DB
 *
 * The returned function runs on suite shutdown and tears the stack down.
 *
 * Skip the teardown (compose stays up between runs) by setting
 * `CONDUIT_TEST_KEEP_STACK=1` — useful for iteration during development.
 */
export default async function setup(): Promise<() => Promise<void>> {
  composeUp();
  resetTestDatabase();
  return async () => {
    if (process.env.CONDUIT_TEST_KEEP_STACK === '1') return;
    composeDown();
  };
}
