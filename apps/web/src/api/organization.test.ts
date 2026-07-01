import { describe, expect, it, vi } from 'vitest';
import {
  ORG_SCOPED_QUERY_KEYS,
  buildInviteUrl,
  invalidateOrgScopedQueries,
  pickNextActiveOrg,
  type OrganizationSummary,
} from './organization.js';

describe('buildInviteUrl', () => {
  it('builds an absolute URL from the provided origin', () => {
    expect(buildInviteUrl('inv-123', 'https://example.com')).toBe(
      'https://example.com/accept-invitation/inv-123',
    );
  });

  it('falls back to window.location.origin when no origin is given', () => {
    const original = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      location: { origin: 'http://localhost:5173' },
    };
    try {
      expect(buildInviteUrl('inv-9')).toBe('http://localhost:5173/accept-invitation/inv-9');
    } finally {
      if (original === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = original;
    }
  });
});

describe('ORG_SCOPED_QUERY_KEYS', () => {
  it('covers every top-level cache key that becomes stale on org switch', () => {
    const flat = ORG_SCOPED_QUERY_KEYS.map((k) => k[0]);
    expect(flat).toEqual(
      expect.arrayContaining([
        'workflows',
        'workflow',
        'run',
        'credentials',
        'connections',
        'templates',
        'triggers',
      ]),
    );
  });
});

describe('pickNextActiveOrg', () => {
  const org = (id: string): OrganizationSummary => ({
    id,
    name: id,
    slug: id,
    createdAt: '2026-05-01T00:00:00Z',
  });

  it('returns the first surviving org after the deleted one is removed', () => {
    expect(pickNextActiveOrg([org('a'), org('b'), org('c')], 'a')).toBe('b');
  });

  it('skips the deleted org even if it is not first', () => {
    expect(pickNextActiveOrg([org('a'), org('b')], 'b')).toBe('a');
  });

  it('returns null when no other org remains', () => {
    expect(pickNextActiveOrg([org('a')], 'a')).toBeNull();
    expect(pickNextActiveOrg([], 'a')).toBeNull();
  });
});

describe('invalidateOrgScopedQueries', () => {
  it('invalidates every scoped key plus the org-plugin caches', async () => {
    const invalidateQueries = vi.fn((_args: { queryKey: readonly unknown[] }) =>
      Promise.resolve(),
    );
    const qc = { invalidateQueries } as unknown as Parameters<
      typeof invalidateOrgScopedQueries
    >[0];

    await invalidateOrgScopedQueries(qc);

    const calls = invalidateQueries.mock.calls.map((c) => c[0].queryKey);
    // Each ORG_SCOPED_QUERY_KEYS entry was passed
    for (const key of ORG_SCOPED_QUERY_KEYS) {
      expect(calls).toContainEqual(key);
    }
    // Plus org plugin keys
    expect(calls).toContainEqual(['organizations']);
    expect(calls).toContainEqual(['organization', 'active']);
    expect(calls).toContainEqual(['organization', 'members']);
    expect(calls).toContainEqual(['organization', 'invitations']);
  });
});
