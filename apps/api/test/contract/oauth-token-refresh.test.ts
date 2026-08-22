import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { Redis } from 'ioredis';
import type { PrismaClient } from '@conduit/database';
import { createOAuthMirrorHooks } from '../../src/auth/oauth-mirror-hooks';
import {
  createPrismaAccountScanner,
  runTokenRefreshSweep,
  REFRESH_WINDOW_MS,
} from '../../src/auth/token-refresh';
import { createRedisAccountLock, LOCK_KEY_PREFIX } from '../../src/auth/token-refresh-lock';
import { CredentialsService } from '../../src/modules/credentials/credentials.service';
import type { PrismaService } from '../../src/common/prisma.service';
import { decrypt } from '../../src/modules/credentials/crypto';
import { seedTwoOrgs, type TwoOrgFixture } from '../../../../test/fixtures/orgs/two-orgs';
import { clearAuthData, clearTenantData, makePrisma } from './setup';

/**
 * Contract for phase 2 of `.specs/oauth-account-linking.md` — token refresh.
 *
 * Two things are proven here that a unit test can't:
 *
 *  1. Which `account` rows the sweep considers due (the Prisma predicate) —
 *     in particular that a GitHub account with no `accessTokenExpiresAt`
 *     ("Token Expiration: Off", the documented setup) is a no-op.
 *  2. That Better Auth's `internalAdapter.updateAccount` — the write the
 *     refresh endpoint performs — fires the *existing* `account.update.after`
 *     mirror hook, so the encrypted `Credential.secret` rotates with no
 *     refresh-specific mirror code. This is the spec's phase-2 verification
 *     note.
 *
 * No OAuth provider is contacted: the sweep's `refresh` step is replaced with
 * the same `updateAccount` call Better Auth makes after redeeming a refresh
 * token, and the profile lookup inside the mirror is stubbed.
 */
describe('OAuth token refresh', () => {
  let prisma: PrismaClient;
  let svc: CredentialsService;
  let fixture: TwoOrgFixture;
  let redis: Redis;

  beforeEach(async () => {
    prisma = makePrisma();
    await clearAuthData(prisma);
    await clearTenantData(prisma);
    fixture = await seedTwoOrgs(prisma);
    svc = new CredentialsService(prisma as unknown as PrismaService);
    redis = new Redis(process.env.REDIS_URL!, { lazyConnect: false });
    const keys = await redis.keys(`${LOCK_KEY_PREFIX}*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  afterEach(async () => {
    await clearAuthData(prisma);
    await clearTenantData(prisma);
    await redis.quit();
    await prisma.$disconnect();
  });

  /** A linked identity: Better Auth `user` + `account` rows. */
  async function seedAccount(params: {
    id: string;
    providerId: string;
    accountId: string;
    accessToken?: string;
    refreshToken?: string | null;
    accessTokenExpiresAt?: Date | null;
  }): Promise<{ accountRowId: string; userId: string }> {
    const userId = `user_${params.id}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: 'Linked User',
        email: `${params.id}@example.com`,
        updatedAt: new Date(),
      },
    });
    await prisma.account.create({
      data: {
        id: params.id,
        userId,
        providerId: params.providerId,
        accountId: params.accountId,
        accessToken: params.accessToken ?? 'token_v1',
        refreshToken: params.refreshToken === undefined ? 'refresh_v1' : params.refreshToken,
        accessTokenExpiresAt: params.accessTokenExpiresAt ?? null,
        scope: 'api,read_user',
        updatedAt: new Date(),
      },
    });
    return { accountRowId: params.id, userId };
  }

  /**
   * A Better Auth instance over the test DB wired with the production mirror
   * hooks. Only the provider profile lookup is faked.
   */
  function makeAuth(profile: Record<string, unknown> = { username: 'gl-user' }) {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => profile,
    }) as unknown as typeof fetch;
    const instance = betterAuth({
      database: prismaAdapter(prisma, { provider: 'postgresql' }),
      secret: 'contract-test-secret',
      baseURL: 'http://localhost',
      databaseHooks: {
        account: createOAuthMirrorHooks({
          credentials: svc,
          membership: prisma,
          ensurePersonalOrgFor: async () => fixture.orgA.id,
          sessionFromHeaders: async () => null,
          fetchFn,
          logger: { warn: vi.fn(), error: vi.fn() },
        }),
      },
    });
    return { instance, fetchFn };
  }

  const inWindow = () => new Date(Date.now() + REFRESH_WINDOW_MS / 2);
  const outOfWindow = () => new Date(Date.now() + REFRESH_WINDOW_MS * 4);

  it('scans only accounts with a refresh token and an expiry inside the window', async () => {
    await seedAccount({
      id: 'row_gitlab_due',
      providerId: 'gitlab',
      accountId: 'gl_1',
      accessTokenExpiresAt: inWindow(),
    });
    // GitHub with "Token Expiration: Off" — no expiry recorded, so no-op.
    await seedAccount({
      id: 'row_github_noexpiry',
      providerId: 'github',
      accountId: 'gh_1',
      accessTokenExpiresAt: null,
    });
    // Still fresh for hours.
    await seedAccount({
      id: 'row_gitlab_fresh',
      providerId: 'gitlab',
      accountId: 'gl_2',
      accessTokenExpiresAt: outOfWindow(),
    });
    // Expiring, but nothing to refresh with (the user must re-link).
    await seedAccount({
      id: 'row_gitlab_norefresh',
      providerId: 'gitlab',
      accountId: 'gl_3',
      refreshToken: null,
      accessTokenExpiresAt: inWindow(),
    });
    // Credential-provider accounts only.
    await seedAccount({
      id: 'row_other_provider',
      providerId: 'credential',
      accountId: 'pw_1',
      accessTokenExpiresAt: inWindow(),
    });

    const scanner = createPrismaAccountScanner(prisma);
    const due = await scanner.findDue(new Date());

    expect(due.map((a) => a.id)).toEqual(['row_gitlab_due']);
    expect(due[0]).toMatchObject({ providerId: 'gitlab', accountId: 'gl_1' });
  });

  it('isStillDue turns false once the row has been refreshed by someone else', async () => {
    const { accountRowId } = await seedAccount({
      id: 'row_recheck',
      providerId: 'gitlab',
      accountId: 'gl_recheck',
      accessTokenExpiresAt: inWindow(),
    });
    const scanner = createPrismaAccountScanner(prisma);
    expect(await scanner.isStillDue(accountRowId, new Date())).toBe(true);

    await prisma.account.update({
      where: { id: accountRowId },
      data: { accessTokenExpiresAt: outOfWindow() },
    });

    expect(await scanner.isStillDue(accountRowId, new Date())).toBe(false);
  });

  it('internalAdapter.updateAccount fires account.update.after and re-mirrors the credential', async () => {
    const { accountRowId } = await seedAccount({
      id: 'row_mirror',
      providerId: 'gitlab',
      accountId: 'gl_mirror',
      accessTokenExpiresAt: inWindow(),
    });
    const { id: credentialId } = await svc.upsertOAuthDerived({
      orgId: fixture.orgA.id,
      accountRowId,
      providerAccountId: 'gl_mirror',
      providerLogin: 'gl-user',
      accessToken: 'gl_access_v1',
      scopes: ['api', 'read_user'],
      platform: 'GITLAB',
      hostUrl: 'gitlab.com',
      tokenExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const { instance } = makeAuth();
    const ctx = await instance.$context;
    const newExpiry = new Date('2026-06-01T09:30:00.000Z');
    await ctx.internalAdapter.updateAccount(accountRowId, {
      accessToken: 'gl_access_v2',
      refreshToken: 'refresh_v2',
      accessTokenExpiresAt: newExpiry,
    });

    const row = await prisma.credential.findUniqueOrThrow({ where: { id: credentialId } });
    expect(decrypt(row.secret)).toBe('gl_access_v2');
    const meta = row.metadata as Record<string, unknown>;
    expect(meta.source).toBe('oauth');
    expect(meta.tokenExpiresAt).toBe(newExpiry.toISOString());
    // Re-mirror updates in place — no duplicate credential for the account.
    const all = await prisma.credential.findMany({
      where: { metadata: { path: ['accountRowId'], equals: accountRowId } },
    });
    expect(all).toHaveLength(1);
  });

  it('a sweep refreshes the due account, rotates the mirrored secret, and frees the lock', async () => {
    const { accountRowId, userId } = await seedAccount({
      id: 'row_sweep',
      providerId: 'gitlab',
      accountId: 'gl_sweep',
      accessTokenExpiresAt: inWindow(),
    });
    const { id: credentialId } = await svc.upsertOAuthDerived({
      orgId: fixture.orgA.id,
      accountRowId,
      providerAccountId: 'gl_sweep',
      providerLogin: 'gl-user',
      accessToken: 'gl_access_v1',
      scopes: ['api', 'read_user'],
      platform: 'GITLAB',
      hostUrl: 'gitlab.com',
      tokenExpiresAt: inWindow(),
    });

    const { instance } = makeAuth();
    const ctx = await instance.$context;
    const refreshedExpiry = new Date(Date.now() + 2 * 60 * 60_000);
    // Stands in for `auth.api.refreshToken` — same write it performs once the
    // provider has handed back a new token pair.
    const refresh = vi.fn(async (input: { providerId: string; accountId: string; userId: string }) => {
      expect(input).toEqual({ providerId: 'gitlab', accountId: 'gl_sweep', userId });
      await ctx.internalAdapter.updateAccount(accountRowId, {
        accessToken: 'gl_access_rotated',
        refreshToken: 'refresh_rotated',
        accessTokenExpiresAt: refreshedExpiry,
      });
    });

    const result = await runTokenRefreshSweep({
      scanner: createPrismaAccountScanner(prisma),
      lock: createRedisAccountLock(redis),
      refresh,
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    expect(result).toEqual({ scanned: 1, refreshed: 1, skipped: 0, failed: 0 });
    const row = await prisma.credential.findUniqueOrThrow({ where: { id: credentialId } });
    expect(decrypt(row.secret)).toBe('gl_access_rotated');
    expect((row.metadata as Record<string, unknown>).tokenExpiresAt).toBe(
      refreshedExpiry.toISOString(),
    );
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountRowId } });
    expect(account.refreshToken).toBe('refresh_rotated');
    // Lock released on the way out, so the next sweep isn't stalled.
    expect(await redis.get(`${LOCK_KEY_PREFIX}${accountRowId}`)).toBeNull();
  });

  it('never redeems a refresh token another process is already holding', async () => {
    const { accountRowId } = await seedAccount({
      id: 'row_contended',
      providerId: 'gitlab',
      accountId: 'gl_contended',
      accessTokenExpiresAt: inWindow(),
    });
    // Another API process got there first.
    await redis.set(`${LOCK_KEY_PREFIX}${accountRowId}`, 'other-process', 'PX', 30_000);
    const refresh = vi.fn();

    const result = await runTokenRefreshSweep({
      scanner: createPrismaAccountScanner(prisma),
      lock: createRedisAccountLock(redis),
      refresh,
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    expect(result).toEqual({ scanned: 1, refreshed: 0, skipped: 1, failed: 0 });
    expect(refresh).not.toHaveBeenCalled();
    // The other process still owns its lock — we must not have released it.
    expect(await redis.get(`${LOCK_KEY_PREFIX}${accountRowId}`)).toBe('other-process');
  });

  it('a dead refresh token leaves the credential stale rather than failing the sweep', async () => {
    const { accountRowId } = await seedAccount({
      id: 'row_dead',
      providerId: 'gitlab',
      accountId: 'gl_dead',
      accessTokenExpiresAt: inWindow(),
    });
    const staleExpiry = new Date(Date.now() - 60_000);
    const { id: credentialId } = await svc.upsertOAuthDerived({
      orgId: fixture.orgA.id,
      accountRowId,
      providerAccountId: 'gl_dead',
      providerLogin: 'gl-user',
      accessToken: 'gl_access_v1',
      scopes: ['api'],
      platform: 'GITLAB',
      hostUrl: 'gitlab.com',
      tokenExpiresAt: staleExpiry,
    });
    const warn = vi.fn();

    const result = await runTokenRefreshSweep({
      scanner: createPrismaAccountScanner(prisma),
      lock: createRedisAccountLock(redis),
      refresh: vi.fn().mockRejectedValue(new Error('Failed to refresh access token')),
      logger: { log: vi.fn(), warn },
    });

    expect(result).toEqual({ scanned: 1, refreshed: 0, skipped: 0, failed: 1 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('re-link'));
    // The credential survives with its stale expiry — that's the UI's cue.
    const row = await prisma.credential.findUniqueOrThrow({ where: { id: credentialId } });
    expect((row.metadata as Record<string, unknown>).tokenExpiresAt).toBe(
      staleExpiry.toISOString(),
    );
    expect(await redis.get(`${LOCK_KEY_PREFIX}${accountRowId}`)).toBeNull();
  });
});
