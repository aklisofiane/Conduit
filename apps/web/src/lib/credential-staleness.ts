/**
 * Staleness of an OAuth-mirrored `Credential`, derived from
 * `metadata.tokenExpiresAt` (written by the API's `upsertOAuthDerived` mirror
 * and pushed forward every time the refresher rotates the token).
 *
 * The refresher runs on an interval and logs-and-continues on failure, so the
 * only signal the client gets that refresh has *stopped* working is the expiry
 * drifting into the past — that's what turns a row stale and prompts a re-link.
 *
 * React-free like `account-linking.ts`: the branching (manual credential, old
 * row with no expiry key, unparseable value, future vs past) is worth unit
 * testing without rendering.
 */
import type { CredentialRow } from '../api/types.js';
import { relativeFromNow, relativeUntil } from './time.js';

export type TokenFreshness =
  /** Not an OAuth row, or no usable `tokenExpiresAt` — show nothing. */
  | 'unknown'
  /** Expiry is in the future; the refresher is keeping up. */
  | 'active'
  /** Expiry is in the past — refresh has been failing, re-link needed. */
  | 'expired';

export interface CredentialTokenStatus {
  freshness: TokenFreshness;
  expiresAt: Date | null;
  /** One-line hint for the credential row's metadata line; null when unknown. */
  hint: string | null;
  /** Tooltip spelling out what the hint means; null when unknown. */
  title: string | null;
  /** True when the row should show the stale badge and a re-link action. */
  stale: boolean;
}

const UNKNOWN: CredentialTokenStatus = {
  freshness: 'unknown',
  expiresAt: null,
  hint: null,
  title: null,
  stale: false,
};

/** OAuth-derived rows are the only ones the mirror stamps an expiry on. */
export function isOAuthCredential(cred: Pick<CredentialRow, 'metadata'>): boolean {
  return cred.metadata?.source === 'oauth';
}

/**
 * Degrades to `unknown` — never to a scary badge — whenever the expiry can't
 * be read: a manual PAT, a row mirrored before `tokenExpiresAt` existed, a
 * provider whose tokens don't expire, or a value that doesn't parse.
 */
export function credentialTokenStatus(
  cred: Pick<CredentialRow, 'metadata'>,
  now: number = Date.now(),
): CredentialTokenStatus {
  if (!isOAuthCredential(cred)) return UNKNOWN;

  const raw = cred.metadata?.tokenExpiresAt;
  if (!raw) return UNKNOWN;

  const expiresAt = new Date(raw);
  if (Number.isNaN(expiresAt.getTime())) return UNKNOWN;

  if (expiresAt.getTime() <= now) {
    return {
      freshness: 'expired',
      expiresAt,
      hint: `token expired ${relativeFromNow(expiresAt, now)}`,
      title:
        'The linked provider token expired and could not be refreshed. Re-link the account to restore it.',
      stale: true,
    };
  }

  return {
    freshness: 'active',
    expiresAt,
    hint: `token expires ${relativeUntil(expiresAt, now)}`,
    title: `Refreshed automatically; current token expires ${expiresAt.toLocaleString()}.`,
    stale: false,
  };
}
