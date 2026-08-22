import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuthConfig } from '../../api/auth-config.js';
import { useOAuthLinkReturn } from '../../hooks/use-oauth-link-return.js';
import { linkSocial } from '../../lib/auth-client.js';
import {
  linkErrorMessage,
  linkableProviders,
  startLink,
  type LinkableProvider,
} from '../../lib/account-linking.js';
import { Button } from '../ui/button.js';

/**
 * Discoverability shortcut above the manual PAT form: the same `linkSocial`
 * flow as the Linked accounts panel on `/settings/account`, so a user who came
 * looking for "add a GitHub credential" doesn't have to know that linking is
 * an account-level concept.
 *
 * Deliberately **not** a second unlink surface — `/settings/account` owns the
 * link/unlink lifecycle, and this row points there for it. On return from the
 * provider, `useOAuthLinkReturn` invalidates `['credentials']` so the mirrored
 * row shows up (with its existing `oauth` chip) without a reload.
 */
export function ConnectOAuthButtons() {
  const { data: authConfig } = useAuthConfig();
  const providers = linkableProviders(authConfig?.oauthProviders);
  const { pathname } = useLocation();
  const { failedProvider, errorCode } = useOAuthLinkReturn();

  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  const banner = linkError ?? linkErrorMessage(errorCode, failedProvider);

  const handleConnect = async (provider: LinkableProvider) => {
    setLinkError(null);
    setPendingProvider(provider.id);
    await startLink({
      linkSocial,
      providerId: provider.id,
      origin: window.location.origin,
      returnPath: pathname,
      onError: (message) => {
        setPendingProvider(null);
        setLinkError(message);
      },
    });
  };

  if (providers.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 border-b border-[var(--color-divider)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {providers.map((provider) => (
          <Button
            key={provider.id}
            onClick={() => void handleConnect(provider)}
            disabled={pendingProvider !== null}
          >
            {pendingProvider === provider.id
              ? 'Redirecting…'
              : `Connect ${provider.label}`}
          </Button>
        ))}
        <span className="font-mono text-small text-[var(--color-text-muted)]">
          Creates an oauth credential from your sign-in — manage links in{' '}
          <Link to="/settings/account" className="underline">
            account settings
          </Link>
          .
        </span>
      </div>
      {banner && (
        <div role="alert" className="font-mono text-small text-[var(--color-error)]">
          {banner}
        </div>
      )}
    </div>
  );
}
