import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@conduit/database';
import { auth } from '../../src/auth/auth.config';
import { makePrisma, clearTenantData } from './setup';

/**
 * Hosted-mode rate-limit contract: the 11th `/sign-in/email` from a single
 * IP within the 5-minute window returns 429. Drives the HTTP entry point
 * (`auth.handler(request)`) because the rate-limit middleware lives on
 * `onRequest` — `auth.api.*` calls bypass it.
 *
 * Local-mode lenience is verified by the unit test against
 * `rateLimitConfig('local')` so we don't need a second contract run with
 * `CONDUIT_DEPLOYMENT=local`.
 */
describe('Rate limit (hosted mode, /sign-in/email = 10 / 5min)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    expect(process.env.CONDUIT_DEPLOYMENT).toBe('hosted');
  });

  beforeEach(async () => {
    prisma = makePrisma();
    // Wipe rate-limit counters so consecutive tests don't share IP state.
    await flushBetterAuthRateLimit();
    // Audit-log + auth tables share the test DB — keep this suite isolated
    // from the audit suite that runs in the same process.
    await prisma.auditLog.deleteMany({});
    await prisma.account.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.member.deleteMany({});
    await prisma.invitation.deleteMany({});
    await prisma.user.deleteMany({});
    await clearTenantData(prisma);
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  it('11th sign-in attempt from one IP within 5 minutes returns 429', async () => {
    const ip = '203.0.113.50';

    // First 10 attempts: rate-limit allows them through. The credentials
    // are intentionally bogus → they all fail at 401, which is fine: we
    // only care about the rate-limit gate, not auth success.
    for (let i = 0; i < 10; i += 1) {
      const res = await auth.handler(makeSignInRequest(ip, `nope-${i}@example.com`));
      expect(res.status).not.toBe(429);
    }

    // 11th attempt: still under-the-radar wrt audit log, but the rate-
    // limit middleware should now return 429 on `onRequest` before reaching
    // the endpoint at all.
    const final = await auth.handler(makeSignInRequest(ip, 'nope-final@example.com'));
    expect(final.status).toBe(429);
  });

  it('different IPs each get their own 10-request budget', async () => {
    // 10 attempts from IP A.
    for (let i = 0; i < 10; i += 1) {
      const res = await auth.handler(makeSignInRequest('203.0.113.51', `a-${i}@example.com`));
      expect(res.status).not.toBe(429);
    }
    // 1st attempt from IP B should NOT be rate-limited — keys are per-IP.
    const fromB = await auth.handler(makeSignInRequest('203.0.113.52', 'b-1@example.com'));
    expect(fromB.status).not.toBe(429);
  });
});

function makeSignInRequest(ip: string, email: string): Request {
  // Better Auth's `baseURL` is set to `http://localhost` in test setup; the
  // path it serves on is `/sign-in/email` (no `/api/auth` prefix at the
  // handler level — that prefix is the Express mount point, stripped by
  // the time the request reaches `auth.handler`).
  return new Request('http://localhost/api/auth/sign-in/email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify({ email, password: 'whatever' }),
  });
}

async function flushBetterAuthRateLimit(): Promise<void> {
  const { Redis } = await import('ioredis');
  const r = new Redis(process.env.REDIS_URL!, { lazyConnect: false });
  try {
    await r.flushdb();
  } finally {
    await r.quit();
  }
}
