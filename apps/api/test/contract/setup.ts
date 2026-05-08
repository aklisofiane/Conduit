import { Redis } from 'ioredis';
import { PrismaClient } from '@conduit/database';
import { TEST_STACK_ENV } from '../../../../test/e2e/stack';

/**
 * Shared bootstrap for the api/contract test project. Each spec opens a
 * fresh `PrismaClient` against the test DB, runs against the seeded fixture,
 * and tears down its own rows in afterEach. The test stack is brought up
 * by `npm run test:infra:up` (CI) or the developer running it locally — see
 * `docs/VALIDATION.md`.
 */
export function makePrisma(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: TEST_STACK_ENV.DATABASE_URL } },
  });
}

/**
 * Tear down every row this suite might have written. Order matches FK
 * dependencies — leaves before parents. Each `deleteMany` is unscoped on
 * purpose: the test DB is shared across specs, so we wipe everything every
 * test rather than relying on per-org filters that would still leak rows
 * if a test threw mid-setup.
 */
export async function clearTenantData(prisma: PrismaClient): Promise<void> {
  await prisma.executionLog.deleteMany({});
  await prisma.nodeRun.deleteMany({});
  await prisma.workflowRun.deleteMany({});
  await prisma.pollSnapshot.deleteMany({});
  await prisma.ticketBranch.deleteMany({});
  await prisma.workflow.deleteMany({});
  await prisma.connection.deleteMany({});
  await prisma.credential.deleteMany({});
  await prisma.member.deleteMany({});
  await prisma.invitation.deleteMany({});
  await prisma.organization.deleteMany({});
}

/**
 * Wipe Better Auth's tables (audit log + identity rows). `auditLog`,
 * `account`, and `session` have no inter-FK so they delete in parallel;
 * `user` runs after to satisfy the FK from `account`/`session`. Pair with
 * `clearTenantData` to also drop `member`/`invitation`/`organization`.
 */
export async function clearAuthData(prisma: PrismaClient): Promise<void> {
  await Promise.all([
    prisma.auditLog.deleteMany({}),
    prisma.account.deleteMany({}),
    prisma.session.deleteMany({}),
  ]);
  await prisma.user.deleteMany({});
}

/**
 * Reset Better Auth's secondary-storage so per-IP rate-limit counters
 * don't leak between specs. `flushdb` is acceptable because the contract
 * suite's Redis only stores rate-limit keys.
 */
export async function flushBetterAuthRateLimit(): Promise<void> {
  const r = new Redis(process.env.REDIS_URL!, { lazyConnect: false });
  try {
    await r.flushdb();
  } finally {
    await r.quit();
  }
}
