import { Logger } from '@nestjs/common';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@conduit/database';
import { auth } from '../../src/auth/auth.config';
import { clearAuthData, clearTenantData, flushBetterAuthRateLimit, makePrisma } from './setup';

/**
 * End-to-end audit-log contract: sign-up, sign-in (success + failure),
 * org member-invite, no-FK survival, and the failed-login spike signal
 * all land as `AuditLog` rows. Drives Better Auth's `auth.api.*` directly;
 * the HTTP-only rate-limit middleware is exercised separately in
 * `audit-rate-limit.test.ts`.
 */
describe('AuditLog: auth + org events', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    // Sanity: contract tests run with `CONDUIT_DEPLOYMENT=hosted` so the
    // rate-limit assertions in the sibling spec hit the tight numbers. Audit
    // logging is mode-independent; the hooks fire either way.
    expect(process.env.CONDUIT_DEPLOYMENT).toBe('hosted');
  });

  beforeEach(async () => {
    prisma = makePrisma();
    await clearAuthData(prisma);
    await clearTenantData(prisma);
    // Each rate-limited test bumps the per-IP counter; clear it so audit
    // tests can run their own sign-ins without tripping the cap.
    await flushBetterAuthRateLimit();
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  it('sign-up writes one auth.signUp row', async () => {
    const email = freshEmail('signup');
    await auth.api.signUpEmail({
      body: { name: 'Test User', email, password: 'pw-validated-12345' },
    });
    const rows = await prisma.auditLog.findMany({
      where: { actorEmail: email },
      orderBy: { createdAt: 'asc' },
    });
    const events = rows.map((r) => r.event);
    // signup also fires session-create + org.created via the shim; only auth.signUp is in scope here.
    expect(events).toContain('auth.signUp');
    const signUpRow = rows.find((r) => r.event === 'auth.signUp')!;
    expect(signUpRow.actorEmail).toBe(email);
    expect(signUpRow.actorUserId).toBeTruthy();
  });

  it('successful sign-in writes one auth.signIn row with actor + ip', async () => {
    const email = freshEmail('si-ok');
    await auth.api.signUpEmail({
      body: { name: 'Test', email, password: 'pw-validated-12345' },
    });
    await prisma.auditLog.deleteMany({});

    await auth.api.signInEmail({
      body: { email, password: 'pw-validated-12345' },
      headers: new Headers({ 'x-forwarded-for': '198.51.100.7' }),
    });

    const rows = await prisma.auditLog.findMany({
      where: { event: 'auth.signIn', actorEmail: email },
    });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.actorUserId).toBeTruthy();
    expect(row.actorEmail).toBe(email);
    expect(row.actorIp).toBe('198.51.100.7');
    expect(row.metadata).toMatchObject({ provider: 'email' });
  });

  it('bad-password sign-in writes auth.signIn.failed with email but no actorUserId', async () => {
    const email = freshEmail('si-bad');
    await auth.api.signUpEmail({
      body: { name: 'Test', email, password: 'pw-correct-12345' },
    });
    await prisma.auditLog.deleteMany({});

    await expect(
      auth.api.signInEmail({
        body: { email, password: 'wrong-password' },
        headers: new Headers({ 'x-forwarded-for': '198.51.100.8' }),
      }),
    ).rejects.toBeDefined();

    const rows = await prisma.auditLog.findMany({ where: { actorEmail: email } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event).toBe('auth.signIn.failed');
    expect(rows[0]!.actorUserId).toBeNull();
    expect(rows[0]!.actorIp).toBe('198.51.100.8');
  });

  it('audit row survives user delete (no-FK guarantee)', async () => {
    const email = freshEmail('survives');
    const u = await auth.api.signUpEmail({
      body: { name: 'Test', email, password: 'pw-validated-12345' },
    });
    expect(u).toBeTruthy();
    const userId = (u as { user: { id: string } }).user.id;

    // Locate the audit row that pinned the userId.
    const rowBefore = await prisma.auditLog.findFirst({
      where: { actorUserId: userId, event: 'auth.signUp' },
    });
    expect(rowBefore).not.toBeNull();

    // Cascade-delete via Better Auth's user delete is plugin-gated; we just
    // wipe via Prisma to provoke the FK cascade chain. AuditLog must remain.
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.account.deleteMany({ where: { userId } });
    await prisma.member.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });

    const rowAfter = await prisma.auditLog.findUnique({ where: { id: rowBefore!.id } });
    expect(rowAfter).not.toBeNull();
    expect(rowAfter!.actorUserId).toBe(userId);
    expect(rowAfter!.actorEmail).toBe(email);
  });

  it('inviting a member writes org.member.invited with metadata.role + inviteeEmail', async () => {
    const inviterEmail = freshEmail('inviter');
    const headers = new Headers({ 'x-forwarded-for': '198.51.100.10' });
    const signUp = await auth.api.signUpEmail({
      body: { name: 'Inviter', email: inviterEmail, password: 'pw-validated-12345' },
      asResponse: true,
    });
    const cookieHeaders = forwardCookies(signUp);
    await prisma.auditLog.deleteMany({});

    const inviteeEmail = freshEmail('invitee');
    await auth.api.createInvitation({
      body: { email: inviteeEmail, role: 'member' },
      headers: mergeHeaders(headers, cookieHeaders),
    });

    const rows = await prisma.auditLog.findMany({
      where: { event: 'org.member.invited' },
    });
    expect(rows).toHaveLength(1);
    const meta = rows[0]!.metadata as { inviteeEmail: string; role: string };
    expect(meta.inviteeEmail).toBe(inviteeEmail);
    expect(meta.role).toBe('member');
    expect(rows[0]!.actorEmail).toBe(inviterEmail);
    expect(rows[0]!.orgId).toBeTruthy();
  });

  it('abuse signal: 11 failed sign-ins for one email triggers one warn line; 10 do not', async () => {
    const email = freshEmail('spike');
    await auth.api.signUpEmail({
      body: { name: 'Spike', email, password: 'pw-correct-12345' },
    });
    await prisma.auditLog.deleteMany({});

    const warnSpy = vi.fn();
    const restore = vi.spyOn(Logger.prototype, 'warn').mockImplementation(warnSpy);
    try {
      // 10 failures: count > 10 is false → no warn.
      for (let i = 0; i < 10; i += 1) {
        await expect(
          auth.api.signInEmail({
            body: { email, password: 'wrong-password' },
            headers: new Headers({ 'x-forwarded-for': '198.51.100.9' }),
          }),
        ).rejects.toBeDefined();
      }
      const calls10 = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes('abuse.failedLoginSpike'),
      );
      expect(calls10).toHaveLength(0);

      // 11th failure trips count > 10 → exactly one warn line.
      await expect(
        auth.api.signInEmail({
          body: { email, password: 'wrong-password' },
          headers: new Headers({ 'x-forwarded-for': '198.51.100.9' }),
        }),
      ).rejects.toBeDefined();

      const calls11 = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes('abuse.failedLoginSpike'),
      );
      expect(calls11).toHaveLength(1);
      expect(String(calls11[0]![0])).toContain(email);
    } finally {
      restore.mockRestore();
    }
  });
});

let counter = 0;
function freshEmail(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}@example.com`;
}

function forwardCookies(signUpResponse: Response): Headers {
  const headers = new Headers();
  const setCookies = signUpResponse.headers.getSetCookie?.() ?? [];
  // Better Auth's `set-cookie` header values are reformatted into the
  // request's `Cookie` header so the next call sees the auth session.
  const cookiePairs = setCookies.map((c) => c.split(';')[0]!.trim()).filter((p) => p.length > 0);
  if (cookiePairs.length > 0) headers.set('cookie', cookiePairs.join('; '));
  return headers;
}

function mergeHeaders(...sources: Headers[]): Headers {
  const out = new Headers();
  for (const h of sources) {
    h.forEach((v, k) => out.set(k, v));
  }
  return out;
}
