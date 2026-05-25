import { composeUp, resetTestDatabase, TEST_STACK_ENV } from '../../../../test/e2e/stack';

/**
 * Vitest globalSetup hook for the `api` (contract) project. Boots the test
 * compose stack (Postgres + Temporal + Redis) and pushes the current Prisma
 * schema. The api specs talk straight to the Postgres test DB via direct
 * `PrismaClient` instances — no api process is spawned.
 *
 * Also pre-populates `process.env.DATABASE_URL` and `REDIS_URL` so any
 * test that imports the in-process Better Auth instance (operational
 * hardening's audit-log + rate-limit suites) reads test-stack URLs rather
 * than the dev URLs hardcoded into `apps/api/src/config.ts`. Without this
 * the auth.config.ts module-level Redis client would point at dev:6379.
 *
 * Skip teardown across iterations with `CONDUIT_TEST_KEEP_STACK=1`.
 */
export default async function setup(): Promise<() => Promise<void>> {
  composeUp();
  resetTestDatabase();
  process.env.DATABASE_URL = TEST_STACK_ENV.DATABASE_URL;
  process.env.REDIS_URL = TEST_STACK_ENV.REDIS_URL;
  // Pin Better Auth's mode so the rate-limit suite drives a known config.
  // `hosted` exercises the tight rate-limits the hardening spec ships;
  // `local`-mode lenience is verified by the unit test against
  // `rateLimitConfig()` so we don't need a separate contract run for it.
  process.env.CONDUIT_DEPLOYMENT ??= 'hosted';
  process.env.CONDUIT_SEED_EMAILS ??= '@example.com';
  process.env.BETTER_AUTH_SECRET ??= 'contract-test-secret';
  process.env.BETTER_AUTH_URL ??= 'http://localhost';
  return async () => {
    /* compose lifecycle is managed by the e2e suite or `npm run test:infra:down`
       — leaving the stack up between api+e2e runs is normal in dev. */
  };
}
