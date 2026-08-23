import { describe, expect, it, vi } from 'vitest';
import {
  runTokenRefreshSweep,
  type AccountScanner,
  type ExpiringAccount,
  type TokenRefreshDeps,
} from './token-refresh';
import type { AccountLock } from './token-refresh-lock';

/**
 * Unit coverage for the refresh sweep's serialization contract. GitLab
 * refresh tokens are single-use, so the interesting behavior is all in *not*
 * refreshing: skipping an account another process holds, re-checking under
 * the lock, and releasing the lock on every exit path. The DB query (which
 * rows are "due") and the mirror round-trip live in
 * `apps/api/test/contract/oauth-token-refresh.test.ts`.
 */

function acct(overrides: Partial<ExpiringAccount> = {}): ExpiringAccount {
  return { id: 'acct_row_1', userId: 'user_1', providerId: 'gitlab', ...overrides };
}

function makeDeps(
  due: ExpiringAccount[],
  overrides: Partial<TokenRefreshDeps> = {},
): {
  deps: TokenRefreshDeps;
  scanner: { findDue: ReturnType<typeof vi.fn>; isStillDue: ReturnType<typeof vi.fn> };
  lock: { acquire: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
  refresh: ReturnType<typeof vi.fn>;
  calls: string[];
} {
  const calls: string[] = [];
  const scanner = {
    findDue: vi.fn(async () => due),
    isStillDue: vi.fn(async (id: string) => {
      calls.push(`check:${id}`);
      return true;
    }),
  };
  const lock = {
    acquire: vi.fn(async (id: string) => {
      calls.push(`acquire:${id}`);
      return `tok_${id}`;
    }),
    release: vi.fn(async (id: string) => {
      calls.push(`release:${id}`);
    }),
  };
  const refresh = vi.fn(async (input: { accountId: string; userId: string }) => {
    calls.push(`refresh:${input.accountId}`);
  });
  const deps: TokenRefreshDeps = {
    scanner: scanner as unknown as AccountScanner,
    lock: lock as unknown as AccountLock,
    refresh,
    logger: { log: vi.fn(), warn: vi.fn() },
    ...overrides,
  };
  return { deps, scanner, lock, refresh, calls };
}

describe('runTokenRefreshSweep', () => {
  it('refreshes each due account by its account row id and releases the lock', async () => {
    const { deps, refresh, lock, calls } = makeDeps([
      acct({ id: 'row_a', userId: 'u1' }),
      acct({ id: 'row_b', providerId: 'github', userId: 'u2' }),
    ]);

    const result = await runTokenRefreshSweep(deps);

    expect(result).toEqual({ scanned: 2, refreshed: 2, skipped: 0, failed: 0 });
    // Better Auth 1.7 selects the account by row id, not by
    // `(providerId, provider-side accountId)`.
    expect(refresh).toHaveBeenNthCalledWith(1, { accountId: 'row_a', userId: 'u1' });
    expect(refresh).toHaveBeenNthCalledWith(2, { accountId: 'row_b', userId: 'u2' });
    // Lock is taken before the refresh and dropped after it, per account.
    expect(calls).toEqual([
      'acquire:row_a',
      'check:row_a',
      'refresh:row_a',
      'release:row_a',
      'acquire:row_b',
      'check:row_b',
      'refresh:row_b',
      'release:row_b',
    ]);
    expect(lock.release).toHaveBeenNthCalledWith(1, 'row_a', 'tok_row_a');
  });

  it('skips an account another process holds without touching its refresh token', async () => {
    const { deps, refresh, lock } = makeDeps([acct({ id: 'row_locked' })]);
    lock.acquire.mockResolvedValueOnce(null);

    const result = await runTokenRefreshSweep(deps);

    expect(result).toEqual({ scanned: 1, refreshed: 0, skipped: 1, failed: 0 });
    expect(refresh).not.toHaveBeenCalled();
    // Nothing to release — releasing here would drop the other holder's lock.
    expect(lock.release).not.toHaveBeenCalled();
  });

  it('re-checks under the lock and skips a row another process already refreshed', async () => {
    const { deps, scanner, refresh, lock } = makeDeps([acct({ id: 'row_raced' })]);
    scanner.isStillDue.mockResolvedValueOnce(false);

    const result = await runTokenRefreshSweep(deps);

    expect(result).toEqual({ scanned: 1, refreshed: 0, skipped: 1, failed: 0 });
    expect(refresh).not.toHaveBeenCalled();
    expect(lock.release).toHaveBeenCalledWith('row_raced', 'tok_row_raced');
  });

  it('logs and continues past a failing refresh, still releasing its lock', async () => {
    const warn = vi.fn();
    const { deps, refresh, lock } = makeDeps([acct({ id: 'row_dead' }), acct({ id: 'row_ok' })], {
      logger: { log: vi.fn(), warn },
    });
    refresh.mockRejectedValueOnce(new Error('Failed to refresh access token'));

    const result = await runTokenRefreshSweep(deps);

    expect(result).toEqual({ scanned: 2, refreshed: 1, skipped: 0, failed: 1 });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(lock.release).toHaveBeenCalledWith('row_dead', 'tok_row_dead');
    expect(lock.release).toHaveBeenCalledWith('row_ok', 'tok_row_ok');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('row_dead'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('re-link'));
  });

  it('survives a release that itself fails', async () => {
    const { deps, lock } = makeDeps([acct({ id: 'row_a' }), acct({ id: 'row_b' })]);
    lock.release.mockRejectedValueOnce(new Error('redis down'));

    const result = await runTokenRefreshSweep(deps);

    expect(result.refreshed).toBe(2);
  });

  it('does nothing when no account is due', async () => {
    const { deps, lock, refresh } = makeDeps([]);

    const result = await runTokenRefreshSweep(deps);

    expect(result).toEqual({ scanned: 0, refreshed: 0, skipped: 0, failed: 0 });
    expect(lock.acquire).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
