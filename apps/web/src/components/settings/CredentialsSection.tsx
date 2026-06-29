import { useState } from 'react';
import { isCloudHost, normalizeHostUrl } from '@conduit/shared/platform';
import type { Platform } from '@conduit/shared/platform';
import type { CredentialRow } from '../../api/types.js';
import {
  useCreateCredential,
  useCredentials,
  useDeleteCredential,
  useUpdateCredential,
} from '../../api/hooks.js';
import { ApiError } from '../../api/client.js';
import { relativeFromNow } from '../../lib/time.js';
import { Select } from '../ui/select.js';
import { SettingsSection } from '../common/SettingsSection.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group.js';

const PLATFORMS = ['GITHUB', 'GITLAB', 'JIRA', 'SLACK', 'DISCORD'] as const;

const PLATFORM_OPTIONS = PLATFORMS.map((p) => ({
  value: p,
  label: p.toLowerCase(),
}));

const VCS_PLATFORMS = new Set<string>(['GITHUB', 'GITLAB']);

/**
 * Rotating a credential propagates to every connection backed by it — there's
 * no per-connection secret override.
 */
export function CredentialsSection() {
  const { data: credentials = [], isLoading } = useCredentials();
  const create = useCreateCredential();
  const del = useDeleteCredential();

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    platform: 'GITHUB' as CredentialRow['platform'],
    name: '',
    secret: '',
    hostUrl: '',
    selfHosted: false,
  });
  const [hostError, setHostError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isVcs = VCS_PLATFORMS.has(form.platform);

  const handlePlatformChange = (platform: CredentialRow['platform']) => {
    const nextIsVcs = VCS_PLATFORMS.has(platform);
    setForm((f) => ({
      ...f,
      platform,
      hostUrl: nextIsVcs && f.selfHosted ? f.hostUrl : '',
      selfHosted: nextIsVcs ? f.selfHosted : false,
    }));
    setHostError(null);
  };

  const handleSelfHostedChange = (selfHosted: boolean) => {
    setForm((f) => ({ ...f, selfHosted, hostUrl: selfHosted ? f.hostUrl : '' }));
    setHostError(null);
  };

  const validateHost = (value: string) => {
    if (!value.trim()) {
      setHostError('Host is required for self-hosted instances');
      return;
    }
    try {
      normalizeHostUrl(value, form.platform as Platform);
      setHostError(null);
    } catch (e) {
      setHostError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleCreate = async () => {
    setError(null);
    try {
      const body: Parameters<typeof create.mutateAsync>[0] = {
        platform: form.platform,
        name: form.name,
        secret: form.secret,
      };
      if (isVcs) {
        body.hostUrl = form.selfHosted ? form.hostUrl : undefined;
      }
      await create.mutateAsync(body);
      setForm({ platform: 'GITHUB', name: '', secret: '', hostUrl: '', selfHosted: false });
      setHostError(null);
      setCreating(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <SettingsSection
      title="Platform credentials"
      description="Encrypted at rest with AES-256-GCM. Used by connections (a credential can back many)."
      creating={creating}
      onToggleCreate={() => setCreating((v) => !v)}
    >
      {creating && (
        <>
          <div className="grid grid-cols-[120px_1fr_1fr_auto] items-end gap-3 border-b border-[var(--color-divider)] px-4 py-3">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-muted)]">
                Platform
              </span>
              <Select
                ariaLabel="Platform"
                value={form.platform}
                onValueChange={(v) => handlePlatformChange(v as CredentialRow['platform'])}
                options={PLATFORM_OPTIONS}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-muted)]">
                Name
              </span>
              <Input
                placeholder="e.g. acme-github-pat"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-muted)]">
                Secret
              </span>
              <Input
                type="password"
                autoComplete="new-password"
                value={form.secret}
                onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))}
              />
            </label>
            <Button
              variant="primary"
              disabled={
                !form.name ||
                !form.secret ||
                create.isPending ||
                (isVcs && form.selfHosted && (!!hostError || !form.hostUrl.trim()))
              }
              onClick={handleCreate}
            >
              {create.isPending ? 'Saving…' : 'Save'}
            </Button>
            {error && (
              <div className="col-span-4 font-mono text-[11px] text-[var(--color-danger)]">
                {error}
              </div>
            )}
          </div>

          {isVcs && (
            <div className="flex flex-col gap-2 border-b border-[var(--color-divider)] px-4 py-3">
              <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-muted)]">
                Instance
              </span>
              <ToggleGroup
                type="single"
                value={form.selfHosted ? 'self' : 'cloud'}
                onValueChange={(v) => {
                  if (v) handleSelfHostedChange(v === 'self');
                }}
                variant="solid"
                size="pill"
                aria-label="Instance type"
              >
                <ToggleGroupItem value="cloud">Cloud</ToggleGroupItem>
                <ToggleGroupItem value="self">Self-hosted</ToggleGroupItem>
              </ToggleGroup>
              {form.selfHosted && (
                <div className="flex flex-col gap-1">
                  <Input
                    placeholder="ghe.example.com"
                    value={form.hostUrl}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, hostUrl: e.target.value }));
                      if (hostError) setHostError(null);
                    }}
                    onBlur={(e) => validateHost(e.target.value)}
                  />
                  {hostError && (
                    <span className="font-mono text-[11px] text-[var(--color-danger)]">
                      {hostError}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <div>
        {isLoading && (
          <div className="flex h-16 items-center justify-center font-mono text-[12px] text-[var(--color-text-muted)]">
            Loading…
          </div>
        )}
        {!isLoading && credentials.length === 0 && !creating && (
          <div className="flex h-24 items-center justify-center font-mono text-[12px] text-[var(--color-text-muted)]">
            No credentials yet.
          </div>
        )}
        {credentials.map((cred) => (
          <CredentialRowView
            key={cred.id}
            cred={cred}
            onDelete={async () => {
              if (!confirm(`Delete credential "${cred.name}"?`)) return;
              try {
                await del.mutateAsync(cred.id);
              } catch (e) {
                alert(e instanceof ApiError ? e.message : String(e));
              }
            }}
          />
        ))}
      </div>
    </SettingsSection>
  );
}

function CredentialRowView({ cred, onDelete }: { cred: CredentialRow; onDelete: () => void }) {
  const update = useUpdateCredential();
  const [rotating, setRotating] = useState(false);
  const [newSecret, setNewSecret] = useState('');

  const handleRotate = async () => {
    if (!newSecret) return;
    await update.mutateAsync({ id: cred.id, body: { secret: newSecret } });
    setRotating(false);
    setNewSecret('');
  };

  return (
    <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 border-b border-[var(--color-divider)] px-4 py-3 last:border-b-0">
      <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-divider)] bg-[var(--color-pill-bg)] font-mono text-[10.5px]">
        {cred.platform.slice(0, 2)}
      </span>
      <div>
        <div className="font-mono text-[13px] font-medium">{cred.name}</div>
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--color-text-muted)]">
          <span>{cred.platform.toLowerCase()}</span>
          {cred.hostUrl && !isCloudHost(cred.platform as Platform, cred.hostUrl) && (
            <span
              className="rounded border border-[var(--color-divider)] bg-[var(--color-pill-bg)] px-1 py-px text-[10px] tracking-wide"
              title={`Self-hosted: ${cred.hostUrl}`}
            >
              {cred.hostUrl}
            </span>
          )}
          {cred.metadata?.source === 'oauth' && (
            <span
              className="rounded border border-[var(--color-divider)] bg-[var(--color-pill-bg)] px-1 py-px text-[10px] uppercase tracking-wide"
              title="Created from your GitHub sign-in. Rotate with a PAT to convert to a manual credential."
            >
              oauth
            </span>
          )}
          <span>· ••••{cred.suffix} · {cred.connectionCount} connection
          {cred.connectionCount === 1 ? '' : 's'} · rotated {relativeFromNow(cred.updatedAt)}</span>
        </div>
        {rotating && (
          <div className="mt-2 flex items-center gap-2">
            <Input
              type="password"
              placeholder="New secret"
              value={newSecret}
              onChange={(e) => setNewSecret(e.target.value)}
              autoFocus
            />
            <Button
              variant="primary"
              onClick={handleRotate}
              disabled={!newSecret || update.isPending}
            >
              {update.isPending ? 'Rotating…' : 'Rotate'}
            </Button>
            <Button
              onClick={() => {
                setRotating(false);
                setNewSecret('');
              }}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
      {!rotating && (
        <Button onClick={() => setRotating(true)}>
          Rotate
        </Button>
      )}
      <Button
        onClick={onDelete}
        disabled={cred.connectionCount > 0}
        title={
          cred.connectionCount > 0
            ? 'Detach all connections using this credential first'
            : 'Delete'
        }
      >
        Delete
      </Button>
    </div>
  );
}
