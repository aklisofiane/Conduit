/**
 * Pure logic behind the two OAuth account-linking surfaces: the **Linked
 * accounts** panel on `/settings/account` (the source of truth for link and
 * unlink) and the **Connect** shortcuts above the manual PAT form on
 * `/settings/integrations`.
 *
 * React-free on purpose — which providers are linkable, which Conduit
 * credential mirrors which Better Auth account, and how Better Auth's error
 * codes read to a human are all branchy enough to be worth unit-testing
 * without rendering.
 */
import type { ConnectionRow, CredentialRow } from '../api/types.js';

export interface LinkableProvider {
  /** Better Auth `providerId` — matches the ids in `GET /auth-config`. */
  id: string;
  label: string;
  platform: CredentialRow['platform'];
}

/**
 * The providers this app knows how to mirror into a `Credential`
 * (`OAUTH_PROVIDER_ADAPTERS` on the API side). A provider only becomes
 * linkable once the deployment also advertises it in `oauthProviders`.
 */
const LINKABLE_PROVIDERS: readonly LinkableProvider[] = [
  { id: 'github', label: 'GitHub', platform: 'GITHUB' },
  { id: 'gitlab', label: 'GitLab', platform: 'GITLAB' },
];

/** Gate on `useAuthConfig().oauthProviders`, same as the sign-in page does. */
export function linkableProviders(
  oauthProviders: readonly string[] | undefined,
): LinkableProvider[] {
  const enabled = new Set(oauthProviders ?? []);
  return LINKABLE_PROVIDERS.filter((p) => enabled.has(p.id));
}

/**
 * Reverse of {@link linkableProviders}: which provider a mirrored credential
 * came from, so a stale OAuth credential row can re-run the same `linkSocial`
 * flow. `undefined` when the deployment no longer advertises that provider —
 * the row can still say it's stale, it just has nowhere to send the user.
 */
export function linkableProviderForPlatform(
  platform: CredentialRow['platform'],
  oauthProviders: readonly string[] | undefined,
): LinkableProvider | undefined {
  return linkableProviders(oauthProviders).find((p) => p.platform === platform);
}

export function providerLabel(providerId: string | null | undefined): string {
  if (!providerId) return 'this provider';
  return LINKABLE_PROVIDERS.find((p) => p.id === providerId)?.label ?? providerId;
}

/** A row from Better Auth's `listAccounts()`. */
export interface LinkedAccount {
  /** The `account` table row id — what the mirror stores as `accountRowId`. */
  id: string;
  providerId: string;
  /** The provider-side user id. */
  accountId: string;
  scopes?: string[];
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export function findLinkedAccount(
  accounts: readonly LinkedAccount[] | undefined,
  providerId: string,
): LinkedAccount | undefined {
  return (accounts ?? []).find((a) => a.providerId === providerId);
}

/**
 * The `Credential` the API's `account.create.after` hook mirrored from this
 * account. Keyed on `metadata.accountRowId` (what `upsertOAuthDerived` is
 * idempotent on); falls back to the provider-side user id for rows mirrored
 * before that key existed.
 */
export function findMirroredCredential(
  credentials: readonly CredentialRow[] | undefined,
  account: LinkedAccount | undefined,
  platform: CredentialRow['platform'],
): CredentialRow | undefined {
  if (!account) return undefined;
  const rows = (credentials ?? []).filter(
    (c) => c.platform === platform && c.metadata?.source === 'oauth',
  );
  return (
    rows.find((c) => c.metadata?.accountRowId === account.id) ??
    rows.find((c) => c.metadata?.providerAccountId === account.accountId)
  );
}

/** Connections that would break if the mirrored credential went away. */
export function dependentConnections(
  connections: readonly ConnectionRow[] | undefined,
  credentialId: string | undefined,
): ConnectionRow[] {
  if (!credentialId) return [];
  return (connections ?? []).filter((c) => c.credentialId === credentialId);
}

/** Best available human handle for a linked account. */
export function accountLogin(
  account: LinkedAccount | undefined,
  credential: CredentialRow | undefined,
): string | undefined {
  if (!account) return undefined;
  return credential?.metadata?.providerLogin ?? account.accountId;
}

/**
 * Better Auth's OAuth callback redirects to `errorCallbackURL?error=<code>`
 * when a link attempt fails (see `api/routes/callback` → `redirectOnError`).
 * Only the codes a *linking* round-trip can actually produce are spelled out;
 * everything else falls back to a generic retry message.
 */
const LINK_ERROR_MESSAGES: Record<string, string> = {
  account_already_linked_to_different_user:
    'That identity is already linked to a different Conduit user. Sign in as that user and unlink it there first.',
  "email_doesn't_match":
    'That account uses a different email address than your Conduit account.',
  unable_to_link_account: 'The provider rejected the link request. Please try again.',
  invalid_code: 'The provider handshake expired before it completed. Please try again.',
  unable_to_get_user_info: 'Could not read your profile from the provider. Please try again.',
};

export function linkErrorMessage(
  code: string | null | undefined,
  providerId?: string | null,
): string | null {
  if (!code) return null;
  const known = LINK_ERROR_MESSAGES[code];
  if (known) return known;
  return `Could not link ${providerLabel(providerId)}. Please try again.`;
}

/**
 * Unlink failures arrive as thrown `AuthClientError`s rather than a redirect.
 * Two are worth rewording:
 *
 * - Better Auth's own last-account guard, whose stock copy ("You can't unlink
 *   your last account") doesn't say what to do about it.
 * - The API's `account.delete.before` refusal, which already names the
 *   dependent connections — passed through verbatim.
 */
export function unlinkErrorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (code === 'FAILED_TO_UNLINK_LAST_ACCOUNT' || /last account/i.test(message)) {
    return 'This is your only way to sign in — set a password first, then unlink.';
  }
  return message || 'Could not unlink this account.';
}

/**
 * `?linked=<provider>` on the success return and `?linkfailed=<provider>` on
 * the error return let the page it lands on tell an OAuth round-trip apart
 * from a plain visit (Better Auth appends its own `error=<code>` to the
 * latter).
 */
export const LINK_RETURN_PARAM = 'linked';
export const LINK_FAILED_PARAM = 'linkfailed';

export function linkCallbackUrl(origin: string, path: string, providerId: string): string {
  const url = new URL(path, origin);
  url.searchParams.set(LINK_RETURN_PARAM, providerId);
  return url.toString();
}

export function linkErrorCallbackUrl(origin: string, path: string, providerId: string): string {
  const url = new URL(path, origin);
  url.searchParams.set(LINK_FAILED_PARAM, providerId);
  return url.toString();
}

export type LinkSocialFn = (args: {
  provider: string;
  callbackURL: string;
  errorCallbackURL?: string;
}) => Promise<{ error?: { message?: string } | null }>;

export interface StartLinkDeps {
  linkSocial: LinkSocialFn;
  providerId: string;
  /** `window.location.origin` — relative callbacks would resolve against the API. */
  origin: string;
  /** Where the provider should drop the user afterwards (this page). */
  returnPath: string;
  onError: (message: string) => void;
}

/**
 * Kicks off the link handshake. On success nothing is returned to render —
 * the client's redirect fetch-plugin has already navigated the browser to the
 * provider, so callers keep their in-flight state set until unload.
 */
export async function startLink(deps: StartLinkDeps): Promise<void> {
  try {
    const res = await deps.linkSocial({
      provider: deps.providerId,
      callbackURL: linkCallbackUrl(deps.origin, deps.returnPath, deps.providerId),
      errorCallbackURL: linkErrorCallbackUrl(deps.origin, deps.returnPath, deps.providerId),
    });
    if (res?.error) {
      deps.onError(
        res.error.message ?? `Could not start ${providerLabel(deps.providerId)} linking.`,
      );
    }
  } catch (e) {
    deps.onError(e instanceof Error ? e.message : String(e));
  }
}
