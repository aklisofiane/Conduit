import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuthConfig } from '../../api/auth-config.js';
import { useConnections, useCredentials } from '../../api/hooks.js';
import { useLinkedAccounts, useUnlinkAccount } from '../../api/linked-accounts.js';
import type { ConnectionRow, CredentialRow } from '../../api/types.js';
import { useOAuthLinkReturn } from '../../hooks/use-oauth-link-return.js';
import { linkSocial } from '../../lib/auth-client.js';
import {
  accountLogin,
  dependentConnections,
  findLinkedAccount,
  findMirroredCredential,
  linkErrorMessage,
  linkableProviders,
  providerLabel,
  startLink,
  unlinkErrorMessage,
  type LinkableProvider,
  type LinkedAccount,
} from '../../lib/account-linking.js';
import { SettingsSection } from '../common/SettingsSection.js';
import { Button } from '../ui/button.js';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog.js';

interface UnlinkTarget {
  provider: LinkableProvider;
  account: LinkedAccount;
  credential: CredentialRow | undefined;
  connections: ConnectionRow[];
}

/**
 * The **Linked accounts** panel on `/settings/account` — the source of truth
 * for linking and unlinking OAuth identities. One row per provider the
 * deployment advertises in `oauthProviders`; linked rows show the provider
 * login and an Unlink action, unlinked rows a Connect action.
 *
 * Linking is a full-page redirect out to the provider and back to this page,
 * so "in flight" here means "waiting for the browser to leave". The mirrored
 * `Credential` is created server-side during the callback (the API's
 * `account.create.after` hook), which is why the return handler invalidates
 * the credential list rather than creating anything from the client.
 */
export function LinkedAccountsSection() {
  const { data: authConfig } = useAuthConfig();
  const providers = linkableProviders(authConfig?.oauthProviders);
  const { pathname } = useLocation();

  const { data: accounts, isLoading } = useLinkedAccounts();
  const { data: credentials } = useCredentials();
  const { data: connections } = useConnections();
  const unlink = useUnlinkAccount();
  const { failedProvider, errorCode } = useOAuthLinkReturn();

  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [target, setTarget] = useState<UnlinkTarget | null>(null);

  const returnError = linkErrorMessage(errorCode, failedProvider);
  const banner = linkError ?? returnError;

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

  const handleUnlink = async () => {
    if (!target) return;
    try {
      await unlink.mutateAsync({ accountId: target.account.id });
      setTarget(null);
    } catch {
      // Rendered from `unlink.error` inside the dialog — the server is the
      // authority on whether an unlink is allowed.
    }
  };

  // Nothing to link on a deployment with no OAuth providers configured.
  if (providers.length === 0) return null;

  return (
    <>
      <SettingsSection
        title="Linked accounts"
        description="Sign in with GitHub or GitLab, and reuse the token as a platform credential. Linking creates an oauth credential in your active organization."
      >
        {banner && (
          <div
            role="alert"
            className="border-b border-[var(--color-divider)] px-4 py-3 font-mono text-small text-[var(--color-error)]"
          >
            {banner}
          </div>
        )}

        {isLoading ? (
          <div className="flex h-16 items-center justify-center font-mono text-small text-[var(--color-text-muted)]">
            Loading…
          </div>
        ) : (
          providers.map((provider) => {
            const account = findLinkedAccount(accounts, provider.id);
            const credential = findMirroredCredential(credentials, account, provider.platform);
            return (
              <ProviderRow
                key={provider.id}
                provider={provider}
                account={account}
                credential={credential}
                pending={pendingProvider === provider.id}
                disabled={pendingProvider !== null}
                onConnect={() => void handleConnect(provider)}
                onUnlink={() => {
                  if (!account) return;
                  unlink.reset();
                  setTarget({
                    provider,
                    account,
                    credential,
                    connections: dependentConnections(connections, credential?.id),
                  });
                }}
              />
            );
          })
        )}
      </SettingsSection>

      <UnlinkDialog
        target={target}
        busy={unlink.isPending}
        error={unlink.error ? unlinkErrorMessage(unlink.error) : null}
        onCancel={() => setTarget(null)}
        onConfirm={() => void handleUnlink()}
      />
    </>
  );
}

function ProviderRow({
  provider,
  account,
  credential,
  pending,
  disabled,
  onConnect,
  onUnlink,
}: {
  provider: LinkableProvider;
  account: LinkedAccount | undefined;
  credential: CredentialRow | undefined;
  pending: boolean;
  disabled: boolean;
  onConnect: () => void;
  onUnlink: () => void;
}) {
  const login = accountLogin(account, credential);

  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-[var(--color-divider)] px-4 py-3 last:border-b-0">
      <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-divider)] bg-[var(--color-pill-bg)] font-mono text-caption">
        {provider.platform.slice(0, 2)}
      </span>
      <div className="min-w-0">
        <div className="font-mono text-base font-medium">{provider.label}</div>
        <div className="truncate font-mono text-small text-[var(--color-text-muted)]">
          {account ? (
            <>
              {login}
              {credential ? ` · credential “${credential.name}”` : ' · credential pending'}
            </>
          ) : (
            'Not connected'
          )}
        </div>
      </div>
      {account ? (
        <Button variant="danger" onClick={onUnlink} disabled={disabled}>
          Unlink
        </Button>
      ) : (
        <Button variant="primary" onClick={onConnect} disabled={disabled}>
          {pending ? 'Redirecting…' : `Connect ${provider.label}`}
        </Button>
      )}
    </div>
  );
}

function UnlinkDialog({
  target,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  target: UnlinkTarget | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!target) return null;
  const { provider, credential, connections } = target;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="w-[520px] max-w-[94vw] p-0">
        <header className="border-b border-[var(--color-divider)] px-5 py-4">
          <DialogTitle
            className="text-lead font-semibold tracking-tight text-[var(--color-text)]"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Unlink {providerLabel(provider.id)}?
          </DialogTitle>
        </header>

        <div className="flex flex-col gap-3 px-5 py-4 font-mono text-small text-[var(--color-text-2)]">
          {credential ? (
            <p>
              This also deletes the mirrored credential{' '}
              <span className="text-[var(--color-text)]">“{credential.name}”</span>. Workflows that
              push or clone with it will stop working until you re-link or add a personal access
              token.
            </p>
          ) : (
            <p>
              No mirrored credential was found for this account, so only the sign-in identity is
              removed.
            </p>
          )}

          {connections.length > 0 && (
            <div className="rounded-[var(--radius)] border border-[var(--color-divider)] bg-[var(--color-pill-bg)] px-3 py-2">
              <div className="text-[var(--color-text)]">
                {connections.length} connection{connections.length === 1 ? '' : 's'} still use
                {connections.length === 1 ? 's' : ''} this credential:
              </div>
              <ul className="mt-1 list-disc pl-4">
                {connections.map((c) => (
                  <li key={c.id}>{c.name}</li>
                ))}
              </ul>
              <div className="mt-1 text-[var(--color-text-muted)]">
                Unlinking is refused while they reference it —{' '}
                <Link to="/settings/integrations" className="underline">
                  detach them first
                </Link>
                .
              </div>
            </div>
          )}

          {error && (
            <div role="alert" className="text-[var(--color-error)]">
              {error}
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-[var(--color-divider)] px-5 py-3">
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Unlinking…' : 'Unlink'}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
