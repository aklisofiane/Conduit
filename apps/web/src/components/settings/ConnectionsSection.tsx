import { useEffect, useMemo, useState } from 'react';
import type { ConnectionScope, ConnectionScopeKind } from '@conduit/shared';
import { isCloudHost } from '@conduit/shared/platform';
import type { Platform } from '@conduit/shared/platform';
import { ApiError } from '../../api/client.js';
import {
  useConnections,
  useCreateConnection,
  useCredentials,
  useDeleteConnection,
  useListProjectBoards,
  useListViewerRepos,
  useListViewerOrgs,
} from '../../api/hooks.js';
import type { ConnectionRow, CredentialRow } from '../../api/types.js';
import { scopeSummary } from '../../lib/connection.js';
import { SearchSelect } from '../common/SearchSelect.js';
import { Select } from '../common/Select.js';

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

function scopeKindsForPlatform(
  platform: CredentialRow['platform'] | undefined,
): { value: ConnectionScopeKind; label: string }[] {
  switch (platform) {
    case 'GITHUB':
      return [
        { value: 'github_repo', label: 'GitHub repo' },
        { value: 'github_projects_v2', label: 'GitHub Projects v2 board' },
        { value: 'none', label: 'No specific scope' },
      ];
    case 'GITLAB':
      return [
        { value: 'gitlab_project', label: 'GitLab project' },
        { value: 'none', label: 'No specific scope' },
      ];
    default:
      return [{ value: 'none', label: 'No specific scope' }];
  }
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
  const [name, setName] = useState('');
  const [credentialId, setCredentialId] = useState<string>(credentials[0]?.id ?? '');
  const [scopeKind, setScopeKind] = useState<ConnectionScopeKind>(
    () => scopeKindsForPlatform(credentials[0]?.platform)[0]?.value ?? 'none',
  );
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [ownerType, setOwnerType] = useState<'user' | 'org'>('org');
  const [boardNumber, setBoardNumber] = useState('');
  const [projectPath, setProjectPath] = useState('');

  const selectedCredential = credentials.find((c) => c.id === credentialId);
  const availableScopeKinds = useMemo(
    () => scopeKindsForPlatform(selectedCredential?.platform),
    [selectedCredential?.platform],
  );

  // Reset scope kind when credential changes and current kind isn't available
  useEffect(() => {
    const first = availableScopeKinds[0];
    if (first && !availableScopeKinds.some((k) => k.value === scopeKind)) {
      setScopeKind(first.value);
    }
  }, [availableScopeKinds, scopeKind]);

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
    if (scopeKind === 'gitlab_project') {
      const trimmed = projectPath.trim();
      if (!trimmed || !trimmed.includes('/')) return null;
      return { kind: 'gitlab_project', projectPath: trimmed };
    }
    return { kind: 'none' };
  }, [scopeKind, owner, repo, ownerType, boardNumber, projectPath]);

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
          <Select
            ariaLabel="Credential"
            value={credentialId}
            onValueChange={setCredentialId}
            placeholder={
              credentials.length === 0 ? 'No credentials — create one first' : undefined
            }
            options={credentials.map((c) => ({
              value: c.id,
              label: `${c.name} · ${c.platform.toLowerCase()}`,
            }))}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
          Scope kind
        </span>
        <Select
          ariaLabel="Scope kind"
          value={scopeKind}
          onValueChange={(v) => setScopeKind(v as ConnectionScopeKind)}
          options={availableScopeKinds}
        />
      </label>

      {scopeKind === 'github_repo' && (
        <RepoScopeRow
          credentialId={credentialId}
          platform={selectedCredential?.platform}
          owner={owner}
          repo={repo}
          onSelect={(o, r) => { setOwner(o); setRepo(r); }}
        />
      )}

      {scopeKind === 'github_projects_v2' && (
        <BoardScopeRow
          credentialId={credentialId}
          ownerType={ownerType}
          owner={owner}
          boardNumber={boardNumber}
          onOwnerType={setOwnerType}
          onOwner={setOwner}
          onBoardNumber={setBoardNumber}
          onOwnerSelect={(login, type) => { setOwner(login); setOwnerType(type); }}
        />
      )}

      {scopeKind === 'gitlab_project' && (
        <GitlabProjectScopeRow
          credentialId={credentialId}
          projectPath={projectPath}
          onSelect={setProjectPath}
        />
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

function RepoScopeRow({
  credentialId,
  platform,
  owner,
  repo,
  onSelect,
}: {
  credentialId: string;
  platform: CredentialRow['platform'] | undefined;
  owner: string;
  repo: string;
  onSelect: (owner: string, repo: string) => void;
}) {
  const [selected, setSelected] = useState('');
  const reposQuery = useListViewerRepos({
    credentialId,
    enabled: !!credentialId,
  });

  const isGitlab = platform === 'GITLAB';
  const repos = (reposQuery.data ?? []) as Array<{ owner?: string; name?: string; path?: string }>;
  const errorMessage = reposQuery.error
    ? reposQuery.error instanceof ApiError
      ? reposQuery.error.message
      : String(reposQuery.error)
    : null;
  const showDropdown = repos.length > 0 && !errorMessage;

  const options = useMemo(() => {
    if (isGitlab) {
      return repos.map((r) => {
        const path = (r as { path: string }).path;
        return { value: path, label: path };
      });
    }
    return repos.map((r) => {
      const gh = r as { owner: string; name: string };
      const fullName = `${gh.owner}/${gh.name}`;
      return { value: fullName, label: fullName };
    });
  }, [repos, isGitlab]);

  const manualValue = owner && repo ? `${owner}/${repo}` : owner || '';

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
          Repository
        </span>
        {showDropdown ? (
          <SearchSelect
            ariaLabel="Repository"
            value={selected}
            onValueChange={(v) => {
              setSelected(v);
              const slash = v.indexOf('/');
              if (slash > 0) onSelect(v.slice(0, slash), v.slice(slash + 1));
            }}
            placeholder="— pick a repo —"
            options={options}
          />
        ) : (
          <input
            className="field-input"
            placeholder="owner/repo"
            value={manualValue}
            onChange={(e) => {
              const v = e.target.value.trim();
              const slash = v.indexOf('/');
              if (slash > 0) {
                onSelect(v.slice(0, slash), v.slice(slash + 1));
              } else {
                onSelect(v, '');
              }
            }}
          />
        )}
      </label>
      <AutoLoadHint
        credentialId={credentialId}
        isLoading={reposQuery.isFetching}
        errorMessage={errorMessage}
        itemCount={repos.length}
        itemLabel="repositories"
      />
    </div>
  );
}

function GitlabProjectScopeRow({
  credentialId,
  projectPath,
  onSelect,
}: {
  credentialId: string;
  projectPath: string;
  onSelect: (projectPath: string) => void;
}) {
  const [selected, setSelected] = useState('');
  const projectsQuery = useListViewerRepos({
    credentialId,
    enabled: !!credentialId,
  });

  const projects = (projectsQuery.data ?? []) as Array<{ path: string }>;
  const errorMessage = projectsQuery.error
    ? projectsQuery.error instanceof ApiError
      ? projectsQuery.error.message
      : String(projectsQuery.error)
    : null;
  const showDropdown = projects.length > 0 && !errorMessage;

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
          Project
        </span>
        {showDropdown ? (
          <SearchSelect
            ariaLabel="Project"
            value={selected}
            onValueChange={(v) => { setSelected(v); onSelect(v); }}
            placeholder="— pick a project —"
            options={projects.map((p) => ({
              value: p.path,
              label: p.path,
            }))}
          />
        ) : (
          <input
            className="field-input"
            placeholder="group/project"
            value={projectPath}
            onChange={(e) => onSelect(e.target.value.trim())}
          />
        )}
      </label>
      <AutoLoadHint
        credentialId={credentialId}
        isLoading={projectsQuery.isFetching}
        errorMessage={errorMessage}
        itemCount={projects.length}
        itemLabel="projects"
      />
    </div>
  );
}

function BoardScopeRow({
  credentialId,
  ownerType,
  owner,
  boardNumber,
  onOwnerType,
  onOwner,
  onBoardNumber,
  onOwnerSelect,
}: {
  credentialId: string;
  ownerType: 'user' | 'org';
  owner: string;
  boardNumber: string;
  onOwnerType: (v: 'user' | 'org') => void;
  onOwner: (v: string) => void;
  onBoardNumber: (v: string) => void;
  onOwnerSelect: (login: string, ownerType: 'user' | 'org') => void;
}) {
  const orgsQuery = useListViewerOrgs({
    credentialId,
    enabled: !!credentialId,
  });

  const orgs = orgsQuery.data ?? [];
  const orgsError = orgsQuery.error
    ? orgsQuery.error instanceof ApiError
      ? orgsQuery.error.message
      : String(orgsQuery.error)
    : null;
  const showOwnerDropdown = orgs.length > 0 && !orgsError;

  const trimmedOwner = owner.trim();
  const [debouncedOwner, setDebouncedOwner] = useState(trimmedOwner);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedOwner(trimmedOwner), 400);
    return () => clearTimeout(t);
  }, [trimmedOwner]);

  const boardsQuery = useListProjectBoards({
    credentialId,
    ownerType,
    owner: debouncedOwner,
    enabled: !!credentialId && !!debouncedOwner,
  });

  const boards = boardsQuery.data ?? [];
  const boardsError = boardsQuery.error
    ? boardsQuery.error instanceof ApiError
      ? boardsQuery.error.message
      : String(boardsQuery.error)
    : null;
  const showBoardDropdown = boards.length > 0 && !boardsError;

  return (
    <div className="flex flex-col gap-2">
      <div className={showOwnerDropdown ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-[110px_minmax(0,1fr)_minmax(0,1.4fr)] gap-3'}>
        {showOwnerDropdown ? (
          <label className="flex min-w-0 flex-col gap-1">
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
              Owner
            </span>
            <Select
              ariaLabel="Owner"
              value={owner}
              onValueChange={(login) => {
                const entry = orgs.find((o) => o.login === login);
                if (entry) onOwnerSelect(entry.login, entry.ownerType);
              }}
              placeholder="— pick an owner —"
              options={orgs.map((o) => ({
                value: o.login,
                label: o.ownerType === 'user' ? `${o.login} (you)` : o.login,
              }))}
            />
          </label>
        ) : (
          <>
            <label className="flex min-w-0 flex-col gap-1">
              <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
                Owner type
              </span>
              <Select
                ariaLabel="Owner type"
                value={ownerType}
                onValueChange={(v) => onOwnerType(v as 'user' | 'org')}
                options={[
                  { value: 'org', label: 'Org' },
                  { value: 'user', label: 'User' },
                ]}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
                Owner
              </span>
              <input
                className="field-input"
                placeholder="acme"
                value={owner}
                onChange={(e) => onOwner(e.target.value)}
              />
            </label>
          </>
        )}
        <label className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
            Project
          </span>
          {showBoardDropdown ? (
            <SearchSelect
              ariaLabel="Project"
              value={boardNumber}
              onValueChange={onBoardNumber}
              placeholder="— pick a project —"
              options={boards.map((b) => ({
                value: String(b.number),
                label: `#${b.number} · ${b.title}`,
              }))}
            />
          ) : (
            <input
              className="field-input"
              type="number"
              min={1}
              placeholder="5"
              value={boardNumber}
              onChange={(e) => onBoardNumber(e.target.value)}
            />
          )}
        </label>
      </div>
      <AutoLoadHint
        credentialId={credentialId}
        isLoading={orgsQuery.isFetching || boardsQuery.isFetching}
        errorMessage={orgsError ?? boardsError}
        itemCount={owner ? boards.length : orgs.length}
        itemLabel={owner ? 'projects' : 'owners'}
      />
    </div>
  );
}

function AutoLoadHint({
  credentialId,
  isLoading,
  errorMessage,
  itemCount,
  itemLabel,
}: {
  credentialId: string;
  isLoading: boolean;
  errorMessage: string | null;
  itemCount: number;
  itemLabel: string;
}) {
  if (!credentialId) return null;
  if (isLoading) {
    return (
      <span className="font-mono text-[11px] text-[var(--color-text-3)]">
        Loading {itemLabel}…
      </span>
    );
  }
  if (errorMessage) {
    return (
      <span className="font-mono text-[11px] text-[var(--color-danger,#d54c4c)]">
        Couldn't load {itemLabel} ({errorMessage}). You can type manually.
      </span>
    );
  }
  if (itemCount === 0) {
    return (
      <span className="font-mono text-[11px] text-[var(--color-text-3)]">
        No {itemLabel} found. You can type manually.
      </span>
    );
  }
  return null;
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
          {conn.credential.hostUrl &&
            !isCloudHost(conn.credential.platform as Platform, conn.credential.hostUrl) &&
            ` · ${conn.credential.hostUrl}`}
          {summary && ` · ${summary}`}
        </div>
      </div>
      <button className="btn" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}
