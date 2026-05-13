import { useMemo, useState } from 'react';
import type { ConnectionScope } from '@conduit/shared';
import { ApiError } from '../../api/client.js';
import {
  useConnections,
  useCreateConnection,
  useCredentials,
  useDeleteConnection,
} from '../../api/hooks.js';
import type { ConnectionRow, CredentialRow } from '../../api/types.js';
import { scopeSummary } from '../../lib/connection.js';

type CreateBody = {
  credentialId: string;
  name: string;
  scope: ConnectionScope;
};

/**
 * Connections are global, not per-workflow: a workflow's trigger and MCP slots
 * reference a connection id, and the same connection can back many workflows.
 */
export function ConnectionsSection() {
  const { data: connections = [], isLoading } = useConnections();
  const { data: credentials = [] } = useCredentials();
  const create = useCreateConnection();
  const del = useDeleteConnection();

  const [creating, setCreating] = useState(false);

  return (
    <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)]">
      <header className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-mono text-[13px] font-semibold">Connections</h2>
          <p className="font-mono text-[11px] text-[var(--color-text-3)]">
            A connection picks a credential and pins it to a scope (a repo, a project board). Workflows reference connections directly.
          </p>
        </div>
        <button className="btn shrink-0 whitespace-nowrap" onClick={() => setCreating((v) => !v)}>
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
            if (!confirm(`Delete connection "${conn.name}"?`)) return;
            try {
              await del.mutateAsync(conn.id);
            } catch (e) {
              alert(e instanceof ApiError ? e.message : String(e));
            }
          }}
        />
      ))}
    </section>
  );
}

const SCOPE_KINDS = [
  { value: 'github_repo', label: 'GitHub repo' },
  { value: 'github_projects_v2', label: 'GitHub Projects v2 board' },
  { value: 'none', label: 'No specific scope' },
] as const;

type ScopeKind = (typeof SCOPE_KINDS)[number]['value'];

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
  const [name, setName] = useState('');
  const [credentialId, setCredentialId] = useState<string>(credentials[0]?.id ?? '');
  const [scopeKind, setScopeKind] = useState<ScopeKind>('github_repo');
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [ownerType, setOwnerType] = useState<'user' | 'org'>('org');
  const [boardNumber, setBoardNumber] = useState('');

  const scope = useMemo<ConnectionScope | null>(() => {
    if (scopeKind === 'github_repo') {
      if (!owner.trim() || !repo.trim()) return null;
      return { kind: 'github_repo', owner: owner.trim(), repo: repo.trim() };
    }
    if (scopeKind === 'github_projects_v2') {
      const num = Number(boardNumber);
      if (!owner.trim() || !Number.isInteger(num) || num <= 0) return null;
      return {
        kind: 'github_projects_v2',
        ownerType,
        owner: owner.trim(),
        number: num,
      };
    }
    return { kind: 'none' };
  }, [scopeKind, owner, repo, ownerType, boardNumber]);

  const saveBlocker = !credentialId
    ? 'Pick a credential'
    : !name
      ? 'Enter a name'
      : !scope
        ? 'Fill in the scope fields'
        : '';
  const canSave = !saveBlocker;

  const handleSave = async () => {
    if (!canSave || !scope) return;
    await onSubmit({ name, credentialId, scope });
  };

  return (
    <div className="flex flex-col gap-3 border-b border-[var(--color-line)] px-4 py-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
            Name
          </span>
          <input
            className="field-input"
            placeholder="e.g. acme/shop repo"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
            Credential
          </span>
          <select
            className="field-input"
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

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
          Scope kind
        </span>
        <select
          className="field-input"
          value={scopeKind}
          onChange={(e) => setScopeKind(e.target.value as ScopeKind)}
        >
          {SCOPE_KINDS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      {scopeKind === 'github_repo' && (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
              Owner / org
            </span>
            <input
              className="field-input"
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
              className="field-input"
              placeholder="shop"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
            />
          </label>
        </div>
      )}

      {scopeKind === 'github_projects_v2' && (
        <div className="grid grid-cols-[110px_1fr_120px] gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
              Owner type
            </span>
            <select
              className="field-input"
              value={ownerType}
              onChange={(e) => setOwnerType(e.target.value as 'user' | 'org')}
            >
              <option value="org">Org</option>
              <option value="user">User</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
              Owner
            </span>
            <input
              className="field-input"
              placeholder="acme"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
              Project #
            </span>
            <input
              className="field-input"
              type="number"
              min={1}
              placeholder="5"
              value={boardNumber}
              onChange={(e) => setBoardNumber(e.target.value)}
            />
          </label>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={!canSave || pending}
          onClick={handleSave}
          title={saveBlocker}
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function ConnectionRowView({ conn, onDelete }: { conn: ConnectionRow; onDelete: () => void }) {
  const summary = scopeSummary(conn.scope);
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-[var(--color-line)] px-4 py-3 last:border-b-0">
      <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] font-mono text-[10.5px]">
        {conn.credential.platform.slice(0, 2)}
      </span>
      <div>
        <div className="font-mono text-[13px] font-medium">{conn.name}</div>
        <div className="font-mono text-[11px] text-[var(--color-text-3)]">
          {conn.credential.name} · {conn.credential.platform.toLowerCase()}
          {summary && ` · ${summary}`}
        </div>
      </div>
      <button className="btn" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}
