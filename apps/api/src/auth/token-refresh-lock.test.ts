import { describe, expect, it, vi } from 'vitest';
import {
  createRedisAccountLock,
  LOCK_KEY_PREFIX,
  LOCK_TTL_MS,
  type LockRedis,
} from './token-refresh-lock';

/**
 * The lock is three Redis calls, but each one is load-bearing: `NX` is what
 * stops two API processes redeeming the same single-use GitLab refresh token,
 * and the compare-and-delete release is what stops a slow process deleting
 * the lock its successor now holds.
 */
function fakeRedis(setResult: 'OK' | null = 'OK') {
  const set = vi.fn(async () => setResult);
  const evalFn = vi.fn(async () => 1);
  return { redis: { set, eval: evalFn } as unknown as LockRedis, set, evalFn };
}

describe('createRedisAccountLock', () => {
  it('acquires with SET NX PX under a namespaced key and returns a release token', async () => {
    const { redis, set } = fakeRedis('OK');

    const token = await createRedisAccountLock(redis).acquire('acct_row_1');

    expect(token).toBeTruthy();
    expect(set).toHaveBeenCalledWith(
      `${LOCK_KEY_PREFIX}acct_row_1`,
      token,
      'PX',
      LOCK_TTL_MS,
      'NX',
    );
  });

  it('returns null when another process already holds the account', async () => {
    const { redis } = fakeRedis(null);

    expect(await createRedisAccountLock(redis).acquire('acct_row_1')).toBeNull();
  });

  it('hands out a distinct token per acquire so releases cannot cross', async () => {
    const { redis } = fakeRedis('OK');
    const lock = createRedisAccountLock(redis);

    expect(await lock.acquire('a')).not.toBe(await lock.acquire('a'));
  });

  it('releases with a compare-and-delete script keyed on our own token', async () => {
    const { redis, evalFn } = fakeRedis('OK');

    await createRedisAccountLock(redis).release('acct_row_1', 'tok_abc');

    const [script, numKeys, key, token] = evalFn.mock.calls[0] as unknown as [
      string,
      number,
      string,
      string,
    ];
    expect(script).toContain('redis.call("get", KEYS[1]) == ARGV[1]');
    expect(script).toContain('del');
    expect(numKeys).toBe(1);
    expect(key).toBe(`${LOCK_KEY_PREFIX}acct_row_1`);
    expect(token).toBe('tok_abc');
  });
});
