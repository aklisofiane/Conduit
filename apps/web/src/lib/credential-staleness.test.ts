import { describe, expect, it } from 'vitest';
import { credentialTokenStatus, isOAuthCredential } from './credential-staleness.js';
import type { CredentialRow } from '../api/types.js';

const NOW = Date.parse('2026-08-22T12:00:00.000Z');

function credential(metadata: CredentialRow['metadata']): Pick<CredentialRow, 'metadata'> {
  return { metadata };
}

function oauth(extra: NonNullable<CredentialRow['metadata']> = {}) {
  return credential({
    source: 'oauth',
    accountRowId: 'acct-row-1',
    providerLogin: 'octo',
    ...extra,
  });
}

describe('isOAuthCredential', () => {
  it('is true only for rows the mirror wrote', () => {
    expect(isOAuthCredential(oauth())).toBe(true);
    expect(isOAuthCredential(credential({ source: 'manual' }))).toBe(false);
    expect(isOAuthCredential(credential(null))).toBe(false);
  });
});

describe('credentialTokenStatus', () => {
  it('says nothing about a manual PAT, even if it somehow carries an expiry', () => {
    const status = credentialTokenStatus(
      credential({ source: 'manual', tokenExpiresAt: '2026-08-22T11:00:00.000Z' }),
      NOW,
    );
    expect(status).toMatchObject({ freshness: 'unknown', hint: null, stale: false });
  });

  it('degrades gracefully on rows mirrored before tokenExpiresAt existed', () => {
    const status = credentialTokenStatus(oauth(), NOW);
    expect(status.freshness).toBe('unknown');
    expect(status.hint).toBeNull();
    expect(status.stale).toBe(false);
  });

  it('degrades gracefully when the expiry is unparseable', () => {
    const status = credentialTokenStatus(oauth({ tokenExpiresAt: 'not-a-date' }), NOW);
    expect(status.freshness).toBe('unknown');
    expect(status.stale).toBe(false);
  });

  it('treats an empty expiry string as unknown rather than expired-at-epoch', () => {
    expect(credentialTokenStatus(oauth({ tokenExpiresAt: '' }), NOW).freshness).toBe('unknown');
  });

  it('shows an expires hint while the refresher is keeping up', () => {
    const status = credentialTokenStatus(
      oauth({ tokenExpiresAt: '2026-08-22T12:42:00.000Z' }),
      NOW,
    );
    expect(status.freshness).toBe('active');
    expect(status.stale).toBe(false);
    expect(status.hint).toBe('token expires in 42m');
    expect(status.expiresAt?.toISOString()).toBe('2026-08-22T12:42:00.000Z');
  });

  it('rounds a multi-hour expiry to hours', () => {
    const status = credentialTokenStatus(
      oauth({ tokenExpiresAt: '2026-08-22T14:00:00.000Z' }),
      NOW,
    );
    expect(status.hint).toBe('token expires in 2h');
  });

  it('goes stale once the expiry is in the past — refresh has been failing', () => {
    const status = credentialTokenStatus(
      oauth({ tokenExpiresAt: '2026-08-22T09:00:00.000Z' }),
      NOW,
    );
    expect(status.freshness).toBe('expired');
    expect(status.stale).toBe(true);
    expect(status.hint).toBe('token expired 3h ago');
    expect(status.title).toMatch(/re-link/i);
  });

  it('counts an expiry exactly at now as expired', () => {
    const status = credentialTokenStatus(
      oauth({ tokenExpiresAt: new Date(NOW).toISOString() }),
      NOW,
    );
    expect(status.freshness).toBe('expired');
    expect(status.stale).toBe(true);
  });

  it('heals back to active when a re-link pushes the expiry forward', () => {
    const stale = credentialTokenStatus(
      oauth({ tokenExpiresAt: '2026-08-22T11:00:00.000Z' }),
      NOW,
    );
    const refreshed = credentialTokenStatus(
      oauth({ tokenExpiresAt: '2026-08-22T14:00:00.000Z' }),
      NOW,
    );
    expect(stale.stale).toBe(true);
    expect(refreshed.stale).toBe(false);
  });
});
