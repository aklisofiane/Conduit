import { useState } from 'react';
import { agentProviderIdSchema } from '@conduit/shared';
import type { ProviderConfig } from '../../api/types.js';
import {
  useCreateProviderConfig,
  useDeleteProviderConfig,
  useProviderConfigs,
  useUpdateProviderConfig,
} from '../../api/hooks.js';
import { ApiError } from '../../api/client.js';
import { relativeFromNow } from '../../lib/time.js';
import { Select } from '../ui/select.js';
import { SettingsSection } from '../common/SettingsSection.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';

const PROVIDER_OPTIONS = agentProviderIdSchema.options.map((p) => ({ value: p, label: p }));

const BASE_URL_PLACEHOLDER: Record<ProviderConfig['providerId'], string> = {
  claude: 'https://api.anthropic.com',
  codex: 'https://api.openai.com/v1',
};

/**
 * Per-org provider API keys consumed directly by the agent runtime. Separate
 * from `Credential` — these are not bound to connections and not referenced
 * from workflow definitions. At most one per provider per org; re-creating
 * for the same provider atomically replaces the row.
 */
export function ApiKeysSection() {
  const { data: configs = [], isLoading } = useProviderConfigs();
  const create = useCreateProviderConfig();
  const del = useDeleteProviderConfig();

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{
    providerId: ProviderConfig['providerId'];
    apiKey: string;
    baseUrl: string;
  }>({
    providerId: 'claude',
    apiKey: '',
    baseUrl: '',
  });
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setError(null);
    try {
      const baseUrl = form.baseUrl.trim();
      await create.mutateAsync({
        providerId: form.providerId,
        apiKey: form.apiKey,
        ...(baseUrl ? { baseUrl } : {}),
      });
      setForm({ providerId: 'claude', apiKey: '', baseUrl: '' });
      setCreating(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <SettingsSection
      title="Provider API keys"
      description="Per-org keys consumed directly by the agent runtime. Encrypted at rest with AES-256-GCM. Falls back to worker env when unset."
      creating={creating}
      onToggleCreate={() => setCreating((v) => !v)}
    >
      {creating && (
        <div className="grid grid-cols-[120px_1fr_1fr_auto] items-end gap-3 border-b border-[var(--color-divider)] px-4 py-3">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-caption uppercase tracking-wide text-[var(--color-text-muted)]">
              Provider
            </span>
            <Select
              ariaLabel="Provider"
              value={form.providerId}
              onValueChange={(v) =>
                setForm((f) => ({
                  ...f,
                  providerId: v as ProviderConfig['providerId'],
                }))
              }
              options={PROVIDER_OPTIONS}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-caption uppercase tracking-wide text-[var(--color-text-muted)]">
              API key
            </span>
            <Input
              type="password"
              autoComplete="new-password"
              value={form.apiKey}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-caption uppercase tracking-wide text-[var(--color-text-muted)]">
              Base URL (optional)
            </span>
            <Input
              placeholder={BASE_URL_PLACEHOLDER[form.providerId]}
              value={form.baseUrl}
              onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
            />
          </label>
          <Button
            variant="primary"
            disabled={!form.apiKey || create.isPending}
            onClick={handleCreate}
          >
            {create.isPending ? 'Saving…' : 'Save'}
          </Button>
          {error && (
            <div className="col-span-4 font-mono text-small text-[var(--color-danger)]">
              {error}
            </div>
          )}
        </div>
      )}

      <div>
        {isLoading && (
          <div className="flex h-16 items-center justify-center font-mono text-small text-[var(--color-text-muted)]">
            Loading…
          </div>
        )}
        {!isLoading && configs.length === 0 && !creating && (
          <div className="flex h-24 items-center justify-center font-mono text-small text-[var(--color-text-muted)]">
            No provider keys yet. Workers will fall back to env defaults.
          </div>
        )}
        {configs.map((cfg) => (
          <ProviderConfigRowView
            key={cfg.id}
            cfg={cfg}
            onDelete={async () => {
              if (!confirm(`Delete ${cfg.providerId} API key?`)) return;
              try {
                await del.mutateAsync(cfg.id);
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

function ProviderConfigRowView({ cfg, onDelete }: { cfg: ProviderConfig; onDelete: () => void }) {
  const update = useUpdateProviderConfig();
  const [rotating, setRotating] = useState(false);
  const [editingBaseUrl, setEditingBaseUrl] = useState(false);
  const [newSecret, setNewSecret] = useState('');
  const [newBaseUrl, setNewBaseUrl] = useState('');

  const handleRotate = async () => {
    if (!newSecret) return;
    await update.mutateAsync({ id: cfg.id, body: { apiKey: newSecret } });
    setRotating(false);
    setNewSecret('');
  };

  const handleSaveBaseUrl = async () => {
    const trimmed = newBaseUrl.trim();
    await update.mutateAsync({
      id: cfg.id,
      body: { baseUrl: trimmed === '' ? null : trimmed },
    });
    setEditingBaseUrl(false);
    setNewBaseUrl('');
  };

  return (
    <div className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-4 border-b border-[var(--color-divider)] px-4 py-3 last:border-b-0">
      <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-divider)] bg-[var(--color-pill-bg)] font-mono text-caption">
        {cfg.providerId.slice(0, 2)}
      </span>
      <div>
        <div className="font-mono text-base font-medium">{cfg.providerId}</div>
        <div className="flex items-center gap-1.5 font-mono text-small text-[var(--color-text-muted)]">
          <span>••••{cfg.suffix}</span>
          <span>· {cfg.baseUrl ?? 'default'}</span>
          <span>· rotated {relativeFromNow(cfg.updatedAt)}</span>
        </div>
        {rotating && (
          <div className="mt-2 flex items-center gap-2">
            <Input
              type="password"
              placeholder="New API key"
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
        {editingBaseUrl && (
          <div className="mt-2 flex items-center gap-2">
            <Input
              placeholder={`${BASE_URL_PLACEHOLDER[cfg.providerId]} (leave empty to clear)`}
              value={newBaseUrl}
              onChange={(e) => setNewBaseUrl(e.target.value)}
              autoFocus
            />
            <Button variant="primary" onClick={handleSaveBaseUrl} disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button
              onClick={() => {
                setEditingBaseUrl(false);
                setNewBaseUrl('');
              }}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
      {!rotating && !editingBaseUrl && (
        <>
          <Button onClick={() => setRotating(true)}>Rotate</Button>
          <Button
            onClick={() => {
              setNewBaseUrl(cfg.baseUrl ?? '');
              setEditingBaseUrl(true);
            }}
          >
            Edit base URL
          </Button>
        </>
      )}
      <Button onClick={onDelete} title="Delete">
        Delete
      </Button>
    </div>
  );
}
