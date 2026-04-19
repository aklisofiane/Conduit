import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../api/client.js';
import {
  useConnections,
  useCreateConnection,
  useCredentials,
  useDeleteConnection,
  useWorkflow,
} from '../api/hooks.js';
import type { ConnectionRow, CredentialRow } from '../api/types.js';

/**
 * Per-workflow connections. A connection binds a workflow to a
 * `PlatformCredential` via an alias, plus optional platform-specific
 * bindings (owner/repo for GitHub) and an optional webhook signing
 * secret. Dropping a connection row deletes the binding, not the
 * credential.
 */
export function ConnectionsPage() {
  const { id: workflowId } = useParams<{ id: string }>();
  const { data: workflow } = useWorkflow(workflowId);
  const { data: connections = [], isLoading } = useConnections(workflowId);
  const { data: credentials = [] } = useCredentials();
  const create = useCreateConnection(workflowId ?? '');
  const del = useDeleteConnection(workflowId ?? '');

  const [creating, setCreating] = useState(false);

  if (!workflowId) return null;

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-6 px-6 pb-16 pt-10">
      <div className="flex items-center gap-3">
        <Link to={`/workflows/${workflowId}`} className="btn">
          ← canvas
        </Link>
        <h1
          className="text-[34px] font-semibold leading-none tracking-tight text-[var(--color-text)]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          {workflow?.name ?? 'Workflow'}
          <em className="text-[var(--color-claude)] not-italic"> · connections</em>
        </h1>
      </div>
      <p className="font-mono text-[12px] text-[var(--color-text-2)]">
        Bind this workflow to a platform credential. Triggers and MCP servers reference connections by alias.
      </p>

      <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)]">
        <header className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
          <h2 className="font-mono text-[13px] font-semibold">Connections</h2>
          <button className="btn" onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancel' : '+ New'}
          </button>
        </header>

        {creating && (
          <CreateConnectionForm
            credentials={credentials}
            pending={create.isPending}
            onCancel={() => setCreating(false)}
            onSubmit={async (body) => {
              try {
                await create.mutateAsync(body);
                setCreating(false);
              } catch (e) {
                alert(e instanceof ApiError ? e.message : String(e));
              }
            }}
          />
        )}

        {isLoading && (
          <div className="flex h-16 items-center justify-center font-mono text-[12px] text-[var(--color-text-3)]">
            Loading…
          </div>
        )}
        {!isLoading && connections.length === 0 && !creating && (
          <div className="flex h-24 items-center justify-center font-mono text-[12px] text-[var(--color-text-4)]">
            No connections yet.
          </div>
        )}
        {connections.map((conn) => (
          <ConnectionRowView
            key={conn.id}
            conn={conn}
            onDelete={async () => {
              if (!confirm(`Delete connection "${conn.alias}"?`)) return;
              try {
                await del.mutateAsync(conn.id);
              } catch (e) {
                alert(e instanceof ApiError ? e.message : String(e));
              }
            }}
          />
        ))}
      </section>
    </div>
  );
}

interface CreateBody {
  alias: string;
  credentialId: string;
  owner?: string;
  repo?: string;
  webhookSecret?: string;
}

function CreateConnectionForm({
  credentials,
  pending,
  onSubmit,
  onCancel,
}: {
  credentials: CredentialRow[];
  pending: boolean;
  onSubmit: (body: CreateBody) => Promise<void>;
  onCancel: () => void;
}) {
  const [alias, setAlias] = useState('');
  const [credentialId, setCredentialId] = useState<string>(credentials[0]?.id ?? '');
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');

  const chosen = useMemo(
    () => credentials.find((c) => c.id === credentialId),
    [credentialId, credentials],
  );
  const needsRepo = chosen?.platform === 'GITHUB' || chosen?.platform === 'GITLAB';

  const canSave = Boolean(alias && credentialId);

  const handleSave = async () => {
    if (!canSave) return;
    await onSubmit({
      alias,
      credentialId,
      owner: owner || undefined,
      repo: repo || undefined,
      webhookSecret: webhookSecret || undefined,
    });
  };

  return (
    <div className="flex flex-col gap-3 border-b border-[var(--color-line)] px-4 py-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
            Alias
          </span>
          <input
            className="input"
            placeholder="e.g. github-main"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
            Credential
          </span>
          <select
            className="input"
            value={credentialId}
            onChange={(e) => setCredentialId(e.target.value)}
          >
            {credentials.length === 0 && <option value="">No credentials — create one first</option>}
            {credentials.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.platform.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
      </div>

      {needsRepo && (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
              Owner / org
            </span>
            <input
              className="input"
              placeholder="acme"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
              Repository
            </span>
            <input
              className="input"
              placeholder="shop"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
            />
          </label>
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
          Webhook signing secret (optional)
        </span>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          placeholder="Paste the secret configured in the platform's webhook settings"
          value={webhookSecret}
          onChange={(e) => setWebhookSecret(e.target.value)}
        />
        <span className="font-mono text-[10.5px] text-[var(--color-text-4)]">
          Encrypted at rest. Required only if this connection's workflow uses a webhook trigger.
        </span>
      </label>

      <div className="flex justify-end gap-2">
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" disabled={!canSave || pending} onClick={handleSave}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function ConnectionRowView({ conn, onDelete }: { conn: ConnectionRow; onDelete: () => void }) {
  const scope = conn.owner && conn.repo ? `${conn.owner}/${conn.repo}` : '—';
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-[var(--color-line)] px-4 py-3 last:border-b-0">
      <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] font-mono text-[10.5px]">
        {conn.credential.platform.slice(0, 2)}
      </span>
      <div>
        <div className="font-mono text-[13px] font-medium">{conn.alias}</div>
        <div className="font-mono text-[11px] text-[var(--color-text-3)]">
          {conn.credential.name} · {conn.credential.platform.toLowerCase()} · {scope}
          {conn.hasWebhookSecret && (
            <>
              {' '}
              · webhook ••••{conn.webhookSecretSuffix ?? '****'}
            </>
          )}
        </div>
      </div>
      <button className="btn" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}
