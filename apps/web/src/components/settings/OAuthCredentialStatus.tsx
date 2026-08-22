import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthConfig } from '../../api/auth-config.js';
import type { CredentialRow } from '../../api/types.js';
import { linkSocial } from '../../lib/auth-client.js';
import { linkableProviderForPlatform, startLink } from '../../lib/account-linking.js';
import { credentialTokenStatus } from '../../lib/credential-staleness.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';

/**
 * The lifecycle half of an OAuth-mirrored credential row: an
 * "expires/refreshed" hint next to the existing `oauth` chip while the API's
 * refresher is keeping the token alive, and — once the expiry has drifted into
 * the past, which is how a dead refresh token surfaces client-side — a `stale`
 * badge plus a Re-link action.
 *
 * Re-link is deliberately the *same* `linkSocial` round-trip the Connect
 * buttons and the Linked accounts panel use: Better Auth re-links the existing
 * account and the `account.update.after` mirror re-writes this credential's
 * secret and `tokenExpiresAt` in place, so the row heals without the user
 * unlinking first. `useOAuthLinkReturn` (mounted by `ConnectOAuthButtons` on
 * this page) invalidates the credential list on the way back.
 *
 * Renders nothing for manual credentials and for OAuth rows with no usable
 * `metadata.tokenExpiresAt` — rows mirrored before that key existed, and
 * providers whose tokens don't expire, must not look broken.
 */
export function OAuthCredentialStatus({ cred }: { cred: CredentialRow }) {
  const { data: authConfig } = useAuthConfig();
  const { pathname } = useLocation();

  const [pending, setPending] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const status = credentialTokenStatus(cred);
  if (status.freshness === 'unknown') return null;

  const provider = linkableProviderForPlatform(cred.platform, authConfig?.oauthProviders);

  const handleRelink = async () => {
    if (!provider) return;
    setLinkError(null);
    setPending(true);
    await startLink({
      linkSocial,
      providerId: provider.id,
      origin: window.location.origin,
      returnPath: pathname,
      onError: (message) => {
        setPending(false);
        setLinkError(message);
      },
    });
  };

  if (!status.stale) {
    return (
      <span title={status.title ?? undefined} className="whitespace-nowrap">
        · {status.hint}
      </span>
    );
  }

  return (
    <>
      <Badge
        variant="chip"
        title={status.title ?? undefined}
        className="rounded border-[var(--color-error)] bg-transparent px-1 py-px uppercase tracking-wide text-[var(--color-error)]"
      >
        stale
      </Badge>
      <span className="whitespace-nowrap text-[var(--color-error)]">{status.hint}</span>
      {provider && (
        <Button
          variant="link"
          size="inline"
          className="underline"
          onClick={() => void handleRelink()}
          disabled={pending}
          title={`Re-link ${provider.label} to refresh this credential`}
        >
          {pending ? 'Redirecting…' : 'Re-link'}
        </Button>
      )}
      {linkError && (
        <span role="alert" className="text-[var(--color-error)]">
          {linkError}
        </span>
      )}
    </>
  );
}
