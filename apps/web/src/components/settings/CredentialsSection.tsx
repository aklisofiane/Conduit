import { useState } from 'react';
import type { CredentialRow } from '../../api/types.js';
import {
  useCreateCredential,
  useCredentials,
  useDeleteCredential,
  useUpdateCredential,
} from '../../api/hooks.js';
import { ApiError } from '../../api/client.js';
import { relativeFromNow } from '../../lib/time.js';

const PLATFORMS = ['GITHUB', 'GITLAB', 'JIRA', 'SLACK', 'DISCORD'] as const;

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
  });
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setError(null);
    try {
      await create.mutateAsync(form);
      setForm({ platform: 'GITHUB', name: '', secret: '' });
      setCreating(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)]">
      <header className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-mono text-[13px] font-semibold">Platform credentials</h2>
          <p className="font-mono text-[11px] text-[var(--color-text-3)]">
            Encrypted at rest with AES-256-GCM. Used by connections (a credential can back many).
          </p>
        </div>
        <button className="btn shrink-0 whitespace-nowrap" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Cancel' : '+ New'}
        </button>
      </header>

      {creating && (
        <div className="grid grid-cols-[120px_1fr_1fr_auto] items-end gap-3 border-b border-[var(--color-line)] px-4 py-3">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
              Platform
            </span>
            <select
              className="field-input"
              value={form.platform}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  platform: e.target.value as CredentialRow['platform'],
                }))
              }
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p.toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
              Name
            </span>
            <input
              className="field-input"
              placeholder="e.g. acme-github-pat"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
              Secret
            </span>
            <input
              className="field-input"
              type="password"
              autoComplete="new-password"
              value={form.secret}
              onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))}
            />
          </label>
          <button
            className="btn primary"
            disabled={!form.name || !form.secret || create.isPending}
            onClick={handleCreate}
          >
            {create.isPending ? 'Saving…' : 'Save'}
          </button>
          {error && (
            <div className="col-span-4 font-mono text-[11px] text-[var(--color-danger)]">
              {error}
            </div>
          )}
        </div>
      )}

      <div>
        {isLoading && (
          <div className="flex h-16 items-center justify-center font-mono text-[12px] text-[var(--color-text-3)]">
            Loading…
          </div>
        )}
        {!isLoading && credentials.length === 0 && !creating && (
          <div className="flex h-24 items-center justify-center font-mono text-[12px] text-[var(--color-text-4)]">
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
    </section>
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
    <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 border-b border-[var(--color-line)] px-4 py-3 last:border-b-0">
      <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] font-mono text-[10.5px]">
        {cred.platform.slice(0, 2)}
      </span>
      <div>
        <div className="font-mono text-[13px] font-medium">{cred.name}</div>
        <div className="font-mono text-[11px] text-[var(--color-text-3)]">
          {cred.platform.toLowerCase()} · ••••{cred.suffix} · {cred.connectionCount} connection
          {cred.connectionCount === 1 ? '' : 's'} · rotated {relativeFromNow(cred.updatedAt)}
        </div>
        {rotating && (
          <div className="mt-2 flex items-center gap-2">
            <input
              className="field-input"
              type="password"
              placeholder="New secret"
              value={newSecret}
              onChange={(e) => setNewSecret(e.target.value)}
              autoFocus
            />
            <button
              className="btn primary"
              onClick={handleRotate}
              disabled={!newSecret || update.isPending}
            >
              {update.isPending ? 'Rotating…' : 'Rotate'}
            </button>
            <button
              className="btn"
              onClick={() => {
                setRotating(false);
                setNewSecret('');
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      {!rotating && (
        <button className="btn" onClick={() => setRotating(true)}>
          Rotate
        </button>
      )}
      <button
        className="btn"
        onClick={onDelete}
        disabled={cred.connectionCount > 0}
        title={
          cred.connectionCount > 0
            ? 'Detach all connections using this credential first'
            : 'Delete'
        }
      >
        Delete
      </button>
    </div>
  );
}
