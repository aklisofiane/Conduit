import { Logger } from '@nestjs/common';
import type { PrismaClient } from '@conduit/database';
import { OAUTH_PROVIDER_ADAPTERS } from './oauth-mirror-hooks';
import type { AccountLock } from './token-refresh-lock';

/**
 * OAuth access-token refresh sweep.
 *
 * A linked GitLab token dies ~2h after the link unless someone redeems the
 * refresh token, which takes the mirrored `Credential` down with it. This
 * module is the "someone": it finds `account` rows whose access token is
 * about to expire and asks Better Auth to refresh each one. Better Auth
 * persists the new tokens through `internalAdapter.updateAccount`, which
 * fires the existing `account.update.after` hook — so the encrypted
 * `Credential.secret` re-mirrors with no refresh-specific mirror code.
 *
 * Deliberately provider-agnostic and *data*-driven: an account is refreshed
 * only when it has both a refresh token and a recorded expiry. GitHub apps
 * with "Token Expiration: Off" (the documented Conduit setup, see
 * `docs/setup-oauth.md`) never record an `accessTokenExpiresAt`, so they
 * no-op here; GitLab always records one and refreshes indefinitely off its
 * rotating refresh token.
 *
 * The Nest wiring (interval, Redis client, Better Auth call) lives in
 * `token-refresh.service.ts`; everything here is dependency-injected so the
 * sweep is testable without a scheduler, Redis, or an OAuth provider.
 */

/** How far ahead of expiry we refresh. */
export const REFRESH_WINDOW_MS = 30 * 60_000;

/** How often the interval service runs the sweep. */
export const REFRESH_INTERVAL_MS = 10 * 60_000;

/** Upper bound on one sweep, so a large backlog can't monopolize a process. */
export const REFRESH_BATCH_LIMIT = 200;

/** Providers whose accounts mirror into credentials — the only ones worth refreshing. */
export const REFRESHABLE_PROVIDERS: readonly string[] = Object.keys(OAUTH_PROVIDER_ADAPTERS);

/** The Better Auth `account` fields the sweep needs. */
export interface ExpiringAccount {
  /**
   * `account.id` — the row id, the lock key, and (since Better Auth 1.7) the
   * `accountId` selector `auth.api.refreshToken` matches on.
   */
  id: string;
  userId: string;
  /** Log/diagnostic only — no longer part of the refresh selector. */
  providerId: string;
}

export interface AccountScanner {
  /** Accounts due for refresh at `now`, soonest expiry first. */
  findDue(now: Date): Promise<ExpiringAccount[]>;
  /**
   * Re-check one row once the lock is held. Another process may have
   * refreshed it between our scan and our lock — redeeming a GitLab refresh
   * token twice burns it, so this second look is load-bearing, not defensive.
   */
  isStillDue(accountRowId: string, now: Date): Promise<boolean>;
}

export interface TokenRefreshDeps {
  scanner: AccountScanner;
  lock: AccountLock;
  /**
   * Wraps `auth.api.refreshToken`; rejects on provider/HTTP failure.
   * `accountId` is the Better Auth `account` **row** id — 1.7 dropped the
   * `(providerId, provider-side accountId)` selector for the row id alone.
   */
  refresh: (input: { accountId: string; userId: string }) => Promise<unknown>;
  logger?: Pick<Logger, 'log' | 'warn'>;
  /** Injectable clock for tests. */
  now?: () => Date;
}

export interface SweepResult {
  scanned: number;
  refreshed: number;
  /** Held by another process, or no longer due once we held the lock. */
  skipped: number;
  failed: number;
}

/**
 * One pass over the due accounts. Failures log-and-continue: a dead refresh
 * token is a re-link the user has to perform, surfaced through the mirrored
 * credential's `metadata.tokenExpiresAt` going stale — not something a
 * background sweep can fix, and not a reason to abandon the other accounts.
 */
export async function runTokenRefreshSweep(deps: TokenRefreshDeps): Promise<SweepResult> {
  const logger = deps.logger ?? new Logger('OAuthTokenRefresh');
  const clock = deps.now ?? (() => new Date());
  const due = await deps.scanner.findDue(clock());
  const result: SweepResult = { scanned: due.length, refreshed: 0, skipped: 0, failed: 0 };

  for (const account of due) {
    const lockToken = await deps.lock.acquire(account.id);
    if (!lockToken) {
      // Another API process owns this account for the next few seconds.
      result.skipped += 1;
      continue;
    }
    try {
      if (!(await deps.scanner.isStillDue(account.id, clock()))) {
        result.skipped += 1;
        continue;
      }
      await deps.refresh({ accountId: account.id, userId: account.userId });
      result.refreshed += 1;
    } catch (err) {
      result.failed += 1;
      logger.warn(
        `OAuth token refresh failed for ${account.providerId} account=${account.id}: ${
          (err as Error).message
        } — user may need to re-link`,
      );
    } finally {
      // Always released, including on the `continue` above: an orphaned lock
      // would stall this account until the TTL lapses.
      await deps.lock.release(account.id, lockToken).catch(() => undefined);
    }
  }

  if (result.scanned > 0) {
    logger.log(
      `OAuth token refresh sweep: scanned=${result.scanned} refreshed=${result.refreshed} skipped=${result.skipped} failed=${result.failed}`,
    );
  }
  return result;
}

/** Structural slice of Prisma the scanner needs (keeps `PrismaService` out of here). */
export type AccountScannerPrisma = Pick<PrismaClient, 'account'>;

/**
 * Prisma-backed scanner. The `refreshToken`/`accessTokenExpiresAt` non-null
 * filters are what makes non-expiring GitHub tokens a no-op — see the module
 * comment.
 */
export function createPrismaAccountScanner(
  prisma: AccountScannerPrisma,
  opts: {
    windowMs?: number;
    limit?: number;
    providerIds?: readonly string[];
  } = {},
): AccountScanner {
  const windowMs = opts.windowMs ?? REFRESH_WINDOW_MS;
  const limit = opts.limit ?? REFRESH_BATCH_LIMIT;
  const providerIds = [...(opts.providerIds ?? REFRESHABLE_PROVIDERS)];

  return {
    async findDue(now) {
      const rows = await prisma.account.findMany({
        where: {
          providerId: { in: providerIds },
          refreshToken: { not: null },
          accessTokenExpiresAt: { not: null, lte: new Date(now.getTime() + windowMs) },
        },
        orderBy: { accessTokenExpiresAt: 'asc' },
        take: limit,
        select: { id: true, userId: true, providerId: true },
      });
      return rows;
    },
    async isStillDue(accountRowId, now) {
      const row = await prisma.account.findUnique({
        where: { id: accountRowId },
        select: { refreshToken: true, accessTokenExpiresAt: true },
      });
      if (!row?.refreshToken || !row.accessTokenExpiresAt) return false;
      return row.accessTokenExpiresAt.getTime() <= now.getTime() + windowMs;
    },
  };
}
