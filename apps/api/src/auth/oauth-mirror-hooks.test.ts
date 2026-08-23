import { describe, expect, it, vi } from 'vitest';
import {
  createOAuthMirrorHooks,
  unlinkBlockedMessage,
  type AuthHookContext,
  type OAuthMirrorDeps,
} from './oauth-mirror-hooks';

/**
 * Unit coverage for the Better Auth `databaseHooks.account` wiring: which org
 * a mirrored credential lands in, and the unlink lifecycle (refuse while
 * referenced, clean up afterwards). The DB round-trip for the mirror itself
 * lives in `apps/api/test/contract/credentials-oauth-mirror.test.ts`.
 */

const GITHUB_ACCOUNT = {
  id: 'acct_row_1',
  userId: 'user_1',
  accountId: '12345',
  providerId: 'github',
  accessToken: 'gho_token',
  scope: 'repo,read:org',
} as never;

function profileFetch(body: Record<string, unknown> = { login: 'octocat' }) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  }) as unknown as typeof fetch;
}

function makeHooks(overrides: Partial<OAuthMirrorDeps> = {}) {
  const credentials = {
    upsertOAuthDerived: vi.fn().mockResolvedValue({ id: 'cred_1', created: true }),
    findOAuthDerivedByAccountRow: vi.fn().mockResolvedValue(null),
    deleteOAuthDerivedByAccountRow: vi
      .fn()
      .mockResolvedValue({ status: 'deleted', dependentConnections: [] }),
  };
  const deps: OAuthMirrorDeps = {
    credentials: credentials as unknown as OAuthMirrorDeps['credentials'],
    membership: { member: { count: vi.fn().mockResolvedValue(1) } },
    ensurePersonalOrgFor: vi.fn().mockResolvedValue('org_personal'),
    sessionFromHeaders: vi.fn().mockResolvedValue(null),
    fetchFn: profileFetch(),
    logger: { warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
  return { hooks: createOAuthMirrorHooks(deps), deps, credentials };
}

/** A hook `context` with just the fields the hooks read. */
function ctx(fields: Record<string, unknown>): AuthHookContext {
  return fields as unknown as AuthHookContext;
}

describe('createOAuthMirrorHooks — active-org attribution', () => {
  it('falls back to the personal org when the hook fires without request context', async () => {
    const { hooks, deps, credentials } = makeHooks();

    await hooks.create!.after!(GITHUB_ACCOUNT, null);

    expect(deps.ensurePersonalOrgFor).toHaveBeenCalledWith('user_1');
    expect(credentials.upsertOAuthDerived).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org_personal',
        accountRowId: 'acct_row_1',
        providerLogin: 'octocat',
        platform: 'GITHUB',
        hostUrl: 'github.com',
        scopes: ['repo', 'read:org'],
      }),
    );
  });

  it('passes the account expiry through so the credential records staleness', async () => {
    const { hooks, credentials } = makeHooks();
    const expiresAt = new Date('2026-01-01T12:00:00.000Z');

    await hooks.update!.after!(
      {
        ...(GITHUB_ACCOUNT as object),
        providerId: 'gitlab',
        accessTokenExpiresAt: expiresAt,
      } as never,
      null,
    );

    expect(credentials.upsertOAuthDerived).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'GITLAB', tokenExpiresAt: expiresAt }),
    );
  });

  it('mirrors a non-expiring token (GitHub, "Token Expiration: Off") with no expiry', async () => {
    const { hooks, credentials } = makeHooks();

    await hooks.create!.after!(GITHUB_ACCOUNT, null);

    expect(credentials.upsertOAuthDerived).toHaveBeenCalledWith(
      expect.objectContaining({ tokenExpiresAt: null }),
    );
  });

  it('uses the active org from the session on the hook context', async () => {
    const { hooks, deps, credentials } = makeHooks();

    await hooks.create!.after!(
      GITHUB_ACCOUNT,
      ctx({
        context: {
          session: { session: { userId: 'user_1', activeOrganizationId: 'org_active' } },
        },
      }),
    );

    expect(deps.ensurePersonalOrgFor).not.toHaveBeenCalled();
    expect(credentials.upsertOAuthDerived).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_active' }),
    );
  });

  it('resolves the active org from the request headers when the context carries no session', async () => {
    const sessionFromHeaders = vi
      .fn()
      .mockResolvedValue({ userId: 'user_1', activeOrganizationId: 'org_active' });
    const { hooks, credentials } = makeHooks({ sessionFromHeaders });

    await hooks.create!.after!(GITHUB_ACCOUNT, ctx({ headers: new Headers() }));

    expect(sessionFromHeaders).toHaveBeenCalled();
    expect(credentials.upsertOAuthDerived).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_active' }),
    );
  });

  it('ignores a session belonging to a different user', async () => {
    const sessionFromHeaders = vi
      .fn()
      .mockResolvedValue({ userId: 'someone_else', activeOrganizationId: 'org_other' });
    const { hooks, deps, credentials } = makeHooks({ sessionFromHeaders });

    await hooks.create!.after!(GITHUB_ACCOUNT, ctx({ headers: new Headers() }));

    expect(deps.ensurePersonalOrgFor).toHaveBeenCalledWith('user_1');
    expect(credentials.upsertOAuthDerived).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_personal' }),
    );
  });

  it('falls back to the personal org when the user no longer belongs to the active org', async () => {
    const { hooks, credentials } = makeHooks({
      membership: { member: { count: vi.fn().mockResolvedValue(0) } },
    });

    await hooks.create!.after!(
      GITHUB_ACCOUNT,
      ctx({
        context: {
          session: { session: { userId: 'user_1', activeOrganizationId: 'org_stale' } },
        },
      }),
    );

    expect(credentials.upsertOAuthDerived).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_personal' }),
    );
  });

  it('never propagates a mirror failure (sign-in must still succeed)', async () => {
    const { hooks, deps } = makeHooks({
      ensurePersonalOrgFor: vi.fn().mockRejectedValue(new Error('db down')),
    });

    await expect(hooks.create!.after!(GITHUB_ACCOUNT, null)).resolves.toBeUndefined();
    expect(deps.logger!.error).toHaveBeenCalled();
  });

  it('no-ops for an unknown provider', async () => {
    const { hooks, credentials } = makeHooks();

    await hooks.update!.after!(
      { ...(GITHUB_ACCOUNT as object), providerId: 'discord' } as never,
      null,
    );

    expect(credentials.upsertOAuthDerived).not.toHaveBeenCalled();
  });
});

describe('createOAuthMirrorHooks — unlink lifecycle', () => {
  const unlinkCtx = ctx({ path: '/unlink-account' });

  it('refuses the unlink when connections still reference the mirrored credential', async () => {
    const { hooks } = makeHooks({
      credentials: {
        upsertOAuthDerived: vi.fn(),
        findOAuthDerivedByAccountRow: vi.fn().mockResolvedValue({
          id: 'cred_1',
          orgId: 'org_1',
          name: 'octocat (oauth)',
          dependentConnections: ['api repo', 'web repo'],
        }),
        deleteOAuthDerivedByAccountRow: vi.fn(),
      } as unknown as OAuthMirrorDeps['credentials'],
    });

    await expect(hooks.delete!.before!(GITHUB_ACCOUNT, unlinkCtx)).rejects.toThrow(
      /octocat \(oauth\).*api repo, web repo/s,
    );
  });

  it('allows the unlink when nothing references the mirrored credential', async () => {
    const { hooks } = makeHooks();

    await expect(hooks.delete!.before!(GITHUB_ACCOUNT, unlinkCtx)).resolves.toBeUndefined();
  });

  it('stands down outside the unlink endpoint so full-user deletion can cascade', async () => {
    const findOAuthDerivedByAccountRow = vi.fn().mockResolvedValue({
      id: 'cred_1',
      orgId: 'org_1',
      name: 'octocat (oauth)',
      dependentConnections: ['api repo'],
    });
    const { hooks } = makeHooks({
      credentials: {
        upsertOAuthDerived: vi.fn(),
        findOAuthDerivedByAccountRow,
        deleteOAuthDerivedByAccountRow: vi.fn(),
      } as unknown as OAuthMirrorDeps['credentials'],
    });

    await expect(
      hooks.delete!.before!(GITHUB_ACCOUNT, ctx({ path: '/delete-user' })),
    ).resolves.toBeUndefined();
    await expect(hooks.delete!.before!(GITHUB_ACCOUNT, null)).resolves.toBeUndefined();
    expect(findOAuthDerivedByAccountRow).not.toHaveBeenCalled();
  });

  it('deletes the mirrored credential after the account row is gone', async () => {
    const { hooks, credentials } = makeHooks();

    await hooks.delete!.after!(GITHUB_ACCOUNT, unlinkCtx);

    expect(credentials.deleteOAuthDerivedByAccountRow).toHaveBeenCalledWith('acct_row_1');
  });

  it('logs instead of throwing when the credential is still referenced after commit', async () => {
    const { hooks, deps } = makeHooks({
      credentials: {
        upsertOAuthDerived: vi.fn(),
        findOAuthDerivedByAccountRow: vi.fn(),
        deleteOAuthDerivedByAccountRow: vi.fn().mockResolvedValue({
          status: 'referenced',
          name: 'octocat (oauth)',
          dependentConnections: ['api repo'],
        }),
      } as unknown as OAuthMirrorDeps['credentials'],
    });

    await expect(hooks.delete!.after!(GITHUB_ACCOUNT, null)).resolves.toBeUndefined();
    expect(deps.logger!.warn).toHaveBeenCalled();
  });

  it('swallows a cleanup failure on the after-commit path', async () => {
    const { hooks, deps } = makeHooks({
      credentials: {
        upsertOAuthDerived: vi.fn(),
        findOAuthDerivedByAccountRow: vi.fn(),
        deleteOAuthDerivedByAccountRow: vi.fn().mockRejectedValue(new Error('db down')),
      } as unknown as OAuthMirrorDeps['credentials'],
    });

    await expect(hooks.delete!.after!(GITHUB_ACCOUNT, null)).resolves.toBeUndefined();
    expect(deps.logger!.error).toHaveBeenCalled();
  });
});

describe('unlinkBlockedMessage', () => {
  it('names every dependent connection up to the cap', () => {
    expect(unlinkBlockedMessage('octocat (oauth)', ['a', 'b'])).toBe(
      'Credential "octocat (oauth)" is used by 2 connection(s) — a, b. Delete them first, then unlink.',
    );
  });

  it('truncates a long list with a count of the remainder', () => {
    const msg = unlinkBlockedMessage('c', ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(msg).toContain('a, b, c, d, e and 2 more');
    expect(msg).toContain('is used by 7 connection(s)');
  });
});
