import { describe, expect, it, vi } from 'vitest';
import {
  accountLogin,
  dependentConnections,
  findLinkedAccount,
  findMirroredCredential,
  linkCallbackUrl,
  linkErrorCallbackUrl,
  linkErrorMessage,
  linkableProviderForPlatform,
  linkableProviders,
  providerLabel,
  startLink,
  unlinkErrorMessage,
  type LinkedAccount,
} from './account-linking.js';
import { AuthClientError } from '../api/auth-result.js';
import type { ConnectionRow, CredentialRow } from '../api/types.js';

function account(overrides: Partial<LinkedAccount> = {}): LinkedAccount {
  return {
    id: 'acct-row-1',
    providerId: 'gitlab',
    accountId: '99001',
    scopes: ['api', 'read_user'],
    ...overrides,
  };
}

function credential(overrides: Partial<CredentialRow> = {}): CredentialRow {
  return {
    id: 'cred-1',
    platform: 'GITLAB',
    name: 'octo (oauth)',
    hostUrl: 'https://gitlab.com',
    metadata: {
      source: 'oauth',
      accountRowId: 'acct-row-1',
      providerAccountId: '99001',
      providerLogin: 'octo',
    },
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    connectionCount: 0,
    suffix: 'abcd',
    ...overrides,
  };
}

function connection(overrides: Partial<ConnectionRow> = {}): ConnectionRow {
  return {
    id: 'conn-1',
    name: 'acme/api',
    credentialId: 'cred-1',
    credential: {
      id: 'cred-1',
      name: 'octo (oauth)',
      platform: 'GITLAB',
      hostUrl: 'https://gitlab.com',
    },
    scope: { kind: 'gitlab_project', projectPath: 'acme/api' },
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

describe('linkableProviders', () => {
  it('returns only providers the deployment advertises, in a stable order', () => {
    expect(linkableProviders(['gitlab', 'github']).map((p) => p.id)).toEqual([
      'github',
      'gitlab',
    ]);
  });

  it('gates each provider independently', () => {
    expect(linkableProviders(['github']).map((p) => p.id)).toEqual(['github']);
    expect(linkableProviders(['gitlab']).map((p) => p.id)).toEqual(['gitlab']);
  });

  it('is empty while auth-config is still loading or nothing is configured', () => {
    expect(linkableProviders(undefined)).toEqual([]);
    expect(linkableProviders([])).toEqual([]);
  });

  it('ignores providers with no credential mirror (e.g. google)', () => {
    expect(linkableProviders(['google'])).toEqual([]);
  });

  it('maps each provider onto its credential platform', () => {
    const byId = new Map(linkableProviders(['github', 'gitlab']).map((p) => [p.id, p]));
    expect(byId.get('github')?.platform).toBe('GITHUB');
    expect(byId.get('gitlab')?.platform).toBe('GITLAB');
  });
});

describe('linkableProviderForPlatform', () => {
  it('maps a mirrored credential back to the provider that created it', () => {
    expect(linkableProviderForPlatform('GITLAB', ['github', 'gitlab'])?.id).toBe('gitlab');
    expect(linkableProviderForPlatform('GITHUB', ['github', 'gitlab'])?.id).toBe('github');
  });

  it('is undefined when the deployment no longer advertises that provider', () => {
    expect(linkableProviderForPlatform('GITLAB', ['github'])).toBeUndefined();
    expect(linkableProviderForPlatform('GITLAB', undefined)).toBeUndefined();
  });

  it('is undefined for platforms with no OAuth link flow', () => {
    expect(linkableProviderForPlatform('JIRA', ['github', 'gitlab'])).toBeUndefined();
  });
});

describe('providerLabel', () => {
  it('gives the branded casing for known providers', () => {
    expect(providerLabel('github')).toBe('GitHub');
    expect(providerLabel('gitlab')).toBe('GitLab');
  });

  it('falls back to the raw id, and to a neutral phrase when unknown', () => {
    expect(providerLabel('bitbucket')).toBe('bitbucket');
    expect(providerLabel(null)).toBe('this provider');
  });
});

describe('findLinkedAccount', () => {
  it('finds the account for a provider', () => {
    const accounts = [account({ providerId: 'github', id: 'a1' }), account({ id: 'a2' })];
    expect(findLinkedAccount(accounts, 'gitlab')?.id).toBe('a2');
  });

  it('returns undefined when the provider is not linked', () => {
    expect(findLinkedAccount([account()], 'github')).toBeUndefined();
    expect(findLinkedAccount(undefined, 'github')).toBeUndefined();
  });
});

describe('findMirroredCredential', () => {
  it('pairs on metadata.accountRowId', () => {
    const rows = [credential({ id: 'other', metadata: { source: 'oauth', accountRowId: 'zzz' } }), credential()];
    expect(findMirroredCredential(rows, account(), 'GITLAB')?.id).toBe('cred-1');
  });

  it('falls back to the provider-side user id for rows mirrored before accountRowId', () => {
    const legacy = credential({
      id: 'legacy',
      metadata: { source: 'oauth', providerAccountId: '99001', providerLogin: 'octo' },
    });
    expect(findMirroredCredential([legacy], account(), 'GITLAB')?.id).toBe('legacy');
  });

  it('never matches a manual PAT credential on the same platform', () => {
    const manual = credential({ id: 'manual', metadata: { source: 'manual' } });
    expect(findMirroredCredential([manual], account(), 'GITLAB')).toBeUndefined();
  });

  it('never matches across platforms', () => {
    expect(findMirroredCredential([credential()], account(), 'GITHUB')).toBeUndefined();
  });

  it('is undefined when the provider is not linked at all', () => {
    expect(findMirroredCredential([credential()], undefined, 'GITLAB')).toBeUndefined();
  });
});

describe('dependentConnections', () => {
  it('names every connection backed by the mirrored credential', () => {
    const rows = [connection(), connection({ id: 'c2', name: 'acme/web' }), connection({ id: 'c3', credentialId: 'other' })];
    expect(dependentConnections(rows, 'cred-1').map((c) => c.name)).toEqual([
      'acme/api',
      'acme/web',
    ]);
  });

  it('is empty when there is no mirrored credential yet', () => {
    expect(dependentConnections([connection()], undefined)).toEqual([]);
  });
});

describe('accountLogin', () => {
  it('prefers the mirrored credential login over the raw provider id', () => {
    expect(accountLogin(account(), credential())).toBe('octo');
  });

  it('falls back to the provider account id when no credential exists yet', () => {
    expect(accountLogin(account(), undefined)).toBe('99001');
  });

  it('is undefined when nothing is linked', () => {
    expect(accountLogin(undefined, credential())).toBeUndefined();
  });
});

describe('linkErrorMessage', () => {
  it('explains an identity already linked to another user', () => {
    expect(linkErrorMessage('account_already_linked_to_different_user', 'github')).toMatch(
      /already linked to a different Conduit user/i,
    );
  });

  it("explains better-auth's email mismatch code", () => {
    expect(linkErrorMessage("email_doesn't_match")).toMatch(/different email address/i);
  });

  it('falls back to a provider-named retry message for unknown codes', () => {
    expect(linkErrorMessage('some_new_code', 'gitlab')).toBe(
      'Could not link GitLab. Please try again.',
    );
  });

  it('is null on a plain page visit', () => {
    expect(linkErrorMessage(null)).toBeNull();
    expect(linkErrorMessage(undefined)).toBeNull();
  });
});

describe('unlinkErrorMessage', () => {
  it('turns the last-account guard into "set a password first"', () => {
    const err = new AuthClientError({
      code: 'FAILED_TO_UNLINK_LAST_ACCOUNT',
      message: "You can't unlink your last account",
    });
    expect(unlinkErrorMessage(err)).toMatch(/set a password first/i);
  });

  it('recognises the last-account guard from its message alone', () => {
    expect(unlinkErrorMessage(new Error("You can't unlink your last account"))).toMatch(
      /set a password first/i,
    );
  });

  it('passes the API refusal through verbatim so the connections stay named', () => {
    const err = new AuthClientError({
      message: 'Credential "octo (oauth)" is used by 2 connection(s) — delete them first',
      status: 409,
    });
    expect(unlinkErrorMessage(err)).toBe(
      'Credential "octo (oauth)" is used by 2 connection(s) — delete them first',
    );
  });

  it('has a fallback for a thrown value with no message', () => {
    expect(unlinkErrorMessage(new Error(''))).toBe('Could not unlink this account.');
    expect(unlinkErrorMessage(null)).toBe('Could not unlink this account.');
  });
});

describe('link callback URLs', () => {
  it('absolutizes against the web origin and tags the return', () => {
    expect(linkCallbackUrl('https://app.test', '/settings/account', 'github')).toBe(
      'https://app.test/settings/account?linked=github',
    );
  });

  it('tags the error return so the banner can name the provider', () => {
    expect(linkErrorCallbackUrl('https://app.test', '/settings/integrations', 'gitlab')).toBe(
      'https://app.test/settings/integrations?linkfailed=gitlab',
    );
  });
});

describe('startLink', () => {
  const deps = {
    origin: 'https://app.test',
    returnPath: '/settings/account',
    providerId: 'gitlab',
  };

  it('hands better-auth an absolute callback and error callback', async () => {
    const linkSocial = vi.fn(async () => ({ error: null }));
    const onError = vi.fn();

    await startLink({ ...deps, linkSocial, onError });

    expect(linkSocial).toHaveBeenCalledWith({
      provider: 'gitlab',
      callbackURL: 'https://app.test/settings/account?linked=gitlab',
      errorCallbackURL: 'https://app.test/settings/account?linkfailed=gitlab',
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('surfaces a synchronous rejection from the link endpoint', async () => {
    const linkSocial = vi.fn(async () => ({ error: { message: 'Provider not configured' } }));
    const onError = vi.fn();

    await startLink({ ...deps, linkSocial, onError });

    expect(onError).toHaveBeenCalledWith('Provider not configured');
  });

  it('surfaces a thrown network failure', async () => {
    const linkSocial = vi.fn(async () => {
      throw new Error('Network down');
    });
    const onError = vi.fn();

    await startLink({ ...deps, linkSocial, onError });

    expect(onError).toHaveBeenCalledWith('Network down');
  });
});
