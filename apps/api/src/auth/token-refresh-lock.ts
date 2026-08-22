/**
 * Per-account distributed lock for the OAuth token refresher.
 *
 * GitLab hands out *single-use* refresh tokens: the moment one is redeemed
 * the previous value is dead. Two hosted API processes sweeping the same
 * `account` row at the same time would race — the loser redeems a token the
 * winner already burned, better-auth writes the failure through, and the user
 * has to re-link. A short Redis lock (SET NX PX) serializes the sweep so only
 * one process ever holds a given account.
 *
 * Release is a compare-and-delete (Lua): if our lock already expired and
 * another process took it, we must not delete *their* lock. A plain `DEL`
 * would do exactly that.
 */

/** Minimal ioredis slice this lock needs — keeps the unit test client-free. */
export interface LockRedis {
  set(
    key: string,
    value: string,
    mode: 'PX',
    ttl: number,
    nx: 'NX',
  ): Promise<'OK' | null>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

export interface AccountLock {
  /** Resolves to a release token, or `null` when someone else holds the lock. */
  acquire(accountRowId: string): Promise<string | null>;
  /** No-op when the lock has already expired and been re-taken elsewhere. */
  release(accountRowId: string, token: string): Promise<void>;
}

/** Namespaced so a `flushdb` in tests (or a Redis inspector) reads clearly. */
export const LOCK_KEY_PREFIX = 'conduit:oauth-refresh:lock:';

/**
 * Long enough to cover a provider token round-trip plus the mirror write that
 * follows it, short enough that a crashed process frees the account before the
 * next sweep (~10min) comes around.
 */
export const LOCK_TTL_MS = 30_000;

const RELEASE_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

export function createRedisAccountLock(redis: LockRedis, ttlMs = LOCK_TTL_MS): AccountLock {
  return {
    async acquire(accountRowId) {
      const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const res = await redis.set(`${LOCK_KEY_PREFIX}${accountRowId}`, token, 'PX', ttlMs, 'NX');
      return res === 'OK' ? token : null;
    },
    async release(accountRowId, token) {
      await redis.eval(RELEASE_SCRIPT, 1, `${LOCK_KEY_PREFIX}${accountRowId}`, token);
    },
  };
}
