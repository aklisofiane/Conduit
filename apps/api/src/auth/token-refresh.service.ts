import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { auth, betterAuthRedis, oauthProviders } from './auth.config';
import { createRedisAccountLock, type AccountLock } from './token-refresh-lock';
import {
  createPrismaAccountScanner,
  runTokenRefreshSweep,
  REFRESH_INTERVAL_MS,
  type AccountScanner,
  type SweepResult,
} from './token-refresh';

/**
 * Nest wiring for the OAuth token-refresh sweep (`token-refresh.ts`).
 *
 * A plain `setInterval` rather than `@nestjs/schedule` — the API has no other
 * scheduled work, and the sweep's cadence is not worth a new dependency. The
 * timer is `unref`'d so it never holds the process open during shutdown, and
 * overlapping ticks are dropped (a slow sweep must not stack).
 *
 * Redis: reuses the module-level client Better Auth already opened for
 * `secondaryStorage` rather than opening a second connection for a few
 * `SET NX` calls every ten minutes.
 */
@Injectable()
export class TokenRefreshService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('OAuthTokenRefresh');
  private readonly scanner: AccountScanner;
  private readonly lock: AccountLock;
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;

  constructor(private readonly prisma: PrismaService) {
    this.scanner = createPrismaAccountScanner(this.prisma);
    this.lock = createRedisAccountLock(betterAuthRedis);
  }

  onModuleInit(): void {
    if (oauthProviders.length === 0) {
      this.logger.log('No OAuth providers configured — token refresher idle');
      return;
    }
    this.timer = setInterval(() => {
      void this.sweepOnce();
    }, REFRESH_INTERVAL_MS);
    this.timer.unref?.();
    this.logger.log(
      `OAuth token refresher started (every ${REFRESH_INTERVAL_MS / 60_000}min, providers=${oauthProviders.join(',')})`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One sweep. Public so tests (and a future admin endpoint) can drive it
   * without waiting on the interval. Returns `null` when a sweep was already
   * running or the sweep itself blew up — the caller is a fire-and-forget
   * timer, so nothing here may reject.
   */
  async sweepOnce(): Promise<SweepResult | null> {
    if (this.inFlight) return null;
    this.inFlight = true;
    try {
      return await runTokenRefreshSweep({
        scanner: this.scanner,
        lock: this.lock,
        refresh: ({ providerId, accountId, userId }) =>
          // `accountId` here is the provider-side id — what Better Auth's
          // `/refresh-token` matches accounts on (`acc.accountId`), not the
          // `account` row id.
          auth.api.refreshToken({ body: { providerId, accountId, userId } }),
        logger: this.logger,
      });
    } catch (err) {
      this.logger.error(
        `OAuth token refresh sweep failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      return null;
    } finally {
      this.inFlight = false;
    }
  }
}
