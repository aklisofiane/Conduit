import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ConnectionScope } from '@conduit/shared';
import { ApiError } from '../../api/client.js';
import {
  useConnections,
  useCreateFromTemplate,
  useCredentials,
  useListProjectBoards,
  useListViewerOrgs,
  useListViewerRepos,
  useTemplates,
} from '../../api/hooks.js';
import type {
  ConnectionRow,
  CredentialRow,
  TemplateBinding,
  TemplateSummary,
} from '../../api/types.js';
import { connectionLabel } from '../../lib/connection.js';
import { Dialog, DialogContent, DialogTitle } from '../common/Dialog.js';
import { SearchSelect } from '../common/SearchSelect.js';
import { Select, type SelectOption } from '../common/Select.js';

function credentialPlatform(
  credentialId: string,
  credentials: CredentialRow[],
): 'GITHUB' | 'GITLAB' | undefined {
  const cred = credentials.find((c) => c.id === credentialId);
  if (!cred) return undefined;
  return cred.platform === 'GITLAB' ? 'GITLAB' : 'GITHUB';
}

function defaultRepoScope(platform: 'GITHUB' | 'GITLAB' | undefined): ConnectionScope {
  if (platform === 'GITLAB') return { kind: 'gitlab_project', projectPath: '' };
  return { kind: 'github_repo', owner: '', repo: '' };
}

function defaultBoardScope(): ConnectionScope {
  return { kind: 'github_projects_v2', ownerType: 'org', owner: '', number: 1 };
}

function newBindingForRepo(
  alias: string,
  credentialId: string,
  platform: 'GITHUB' | 'GITLAB' | undefined,
): TemplateBinding {
  return {
    mode: 'new',
    name: alias,
    credentialId,
    scope: defaultRepoScope(platform),
  };
}

function newBindingForBoard(alias: string, credentialId: string): TemplateBinding {
  return {
    mode: 'new',
    name: alias,
    credentialId,
    scope: defaultBoardScope(),
  };
}

function defaultBindingForRepo(
  alias: string,
  credentials: CredentialRow[],
  connections: ConnectionRow[],
): TemplateBinding {
  const eligible = connections.filter(
    (c) => c.scope.kind === 'github_repo' || c.scope.kind === 'gitlab_project',
  );
  const only = eligible.length === 1 ? eligible[0] : undefined;
  if (eligible.length > 0) {
    return { mode: 'existing', connectionId: only?.id ?? '' };
  }
  return newBindingForRepo(alias, credentials[0]?.id ?? '', undefined);
}

function defaultBindingForBoard(
  alias: string,
  credentials: CredentialRow[],
  connections: ConnectionRow[],
): TemplateBinding {
  const eligible = connections.filter(
    (c) => c.scope.kind === 'github_projects_v2',
  );
  const only = eligible.length === 1 ? eligible[0] : undefined;
  if (eligible.length > 0) {
    return { mode: 'existing', connectionId: only?.id ?? '' };
  }
  return newBindingForBoard(alias, credentials[0]?.id ?? '');
}

export function TemplatePickerDialog({ onClose }: { onClose: () => void }) {
  const { data: templates = [], isLoading } = useTemplates();
  const { data: credentials = [] } = useCredentials();
  const { data: connections = [] } = useConnections();
  const createFromTemplate = useCreateFromTemplate();
  const navigate = useNavigate();

  const [selected, setSelected] = useState<TemplateSummary | null>(null);
  const [bindings, setBindings] = useState<Record<string, TemplateBinding>>({});
  const [error, setError] = useState<string | null>(null);

  const boardAliasSet = useMemo(
    () => new Set(selected?.boardAliases ?? []),
    [selected],
  );
  const repoAliases = useMemo(
    () => (selected?.placeholders ?? []).filter((p) => !boardAliasSet.has(p)),
    [selected, boardAliasSet],
  );
  const boardAlias = selected?.boardAliases?.[0];

  const repoPlatform = (() => {
    let found: 'GITHUB' | 'GITLAB' | undefined;
    for (const alias of repoAliases) {
      const b = bindings[alias];
      if (!b) continue;
      let p: 'GITHUB' | 'GITLAB' | undefined;
      if (b.mode === 'new') {
        p = credentialPlatform(b.credentialId, credentials);
      } else if (b.mode === 'existing') {
        const conn = connections.find((c) => c.id === b.connectionId);
        if (conn) p = conn.credential.platform === 'GITLAB' ? 'GITLAB' : 'GITHUB';
      }
      if (p === 'GITHUB') return 'GITHUB' as const;
      if (p) found = p;
    }
    return found;
  })();
  const showBoard = boardAlias != null && repoPlatform === 'GITHUB';

  useEffect(() => {
    if (showBoard && boardAlias && !bindings[boardAlias]) {
      setBindings((prev) => ({
        ...prev,
        [boardAlias]: defaultBindingForBoard(boardAlias, credentials, connections),
      }));
    }
  }, [showBoard, boardAlias, bindings, credentials, connections]);

  const canCreate =
    !!selected &&
    repoAliases.every((p) => {
      const b = bindings[p];
      if (!b) return false;
      if (b.mode === 'existing') return Boolean(b.connectionId);
      return Boolean(b.name && b.credentialId && b.scope);
    }) &&
    (!showBoard ||
      (() => {
        const b = bindings[boardAlias!];
        if (!b) return false;
        if (b.mode === 'existing') return Boolean(b.connectionId);
        return Boolean(b.name && b.credentialId && b.scope);
      })());

  const handlePick = (t: TemplateSummary) => {
    setSelected(t);
    const boards = new Set(t.boardAliases);
    setBindings(
      Object.fromEntries(
        t.placeholders
          .filter((alias) => !boards.has(alias))
          .map<[string, TemplateBinding]>((alias) => [
            alias,
            defaultBindingForRepo(alias, credentials, connections),
          ]),
      ),
    );
    setError(null);
  };

  const handleCreate = async () => {
    if (!selected) return;
    setError(null);
    const finalBindings = { ...bindings };
    if (boardAlias && !showBoard) {
      delete finalBindings[boardAlias];
    }
    try {
      const result = await createFromTemplate.mutateAsync({
        templateId: selected.id,
        bindings: finalBindings,
      });
      onClose();
      if (result.workflows[0]) {
        navigate(`/workflows/${result.workflows[0].id}`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  const orderedAliases = useMemo(() => {
    const result = [...repoAliases];
    if (showBoard && boardAlias) result.push(boardAlias);
    return result;
  }, [repoAliases, showBoard, boardAlias]);

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[85vh] w-[680px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-bg-1)] p-0 shadow-none"
      >
        <header className="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-4">
          <div>
            <DialogTitle
              className="text-[22px] font-semibold tracking-tight text-[var(--color-text)]"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              {selected ? `Configure ${selected.name}` : 'Start from a template'}
            </DialogTitle>
            <p className="mt-0.5 font-mono text-[11px] text-[var(--color-text-3)]">
              {selected
                ? `${selected.workflowCount} workflow${selected.workflowCount === 1 ? '' : 's'} · ${orderedAliases.length} connection${orderedAliases.length === 1 ? '' : 's'} to bind`
                : 'Pre-built workflow blueprints you can copy and edit.'}
            </p>
          </div>
          <button className="btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading && <div className="font-mono text-[12px] text-[var(--color-text-3)]">Loading templates…</div>}

          {!selected && !isLoading && templates.length === 0 && (
            <div className="font-mono text-[12px] text-[var(--color-text-3)]">
              No templates found — check that <code>/templates</code> exists at the repo root.
            </div>
          )}

          {!selected && templates.length > 0 && (
            <div className="flex flex-col gap-2">
              {templates.map((t) => (
                <TemplateCard key={t.id} t={t} onPick={handlePick} />
              ))}
            </div>
          )}

          {selected && (
            <div className="flex flex-col gap-4">
              <p className="font-mono text-[12px] text-[var(--color-text-2)]">
                {selected.description}
              </p>
              {orderedAliases.length === 0 ? (
                <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-3 py-2 font-mono text-[12px] text-[var(--color-text-2)]">
                  No connection bindings needed.
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {orderedAliases.map((alias) => (
                    <BindingRow
                      key={alias}
                      alias={alias}
                      isBoard={boardAliasSet.has(alias)}
                      binding={bindings[alias]}
                      credentials={credentials}
                      connections={connections}
                      onChange={(b) =>
                        setBindings((prev) => ({ ...prev, [alias]: b }))
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-[var(--color-line)] px-5 py-3">
          {error ? (
            <div className="font-mono text-[11px] text-[var(--color-danger)]">{error}</div>
          ) : (
            <div className="font-mono text-[11px] text-[var(--color-text-3)]">
              Workflows are created paused — review + activate on the canvas.
            </div>
          )}
          <div className="flex items-center gap-2">
            {selected && (
              <button className="btn" onClick={() => setSelected(null)} disabled={createFromTemplate.isPending}>
                ← Back
              </button>
            )}
            <button
              className="btn primary"
              onClick={handleCreate}
              disabled={!selected || !canCreate || createFromTemplate.isPending}
            >
              {createFromTemplate.isPending
                ? 'Creating…'
                : selected
                  ? `Create ${selected.workflowCount === 1 ? 'workflow' : `${selected.workflowCount} workflows`}`
                  : 'Pick a template'}
            </button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function TemplateCard({
  t,
  onPick,
}: {
  t: TemplateSummary;
  onPick: (t: TemplateSummary) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(t)}
      className="flex flex-col items-start gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3 text-left transition-colors hover:border-[var(--color-claude)]"
    >
      <div className="flex w-full items-center justify-between">
        <span className="font-mono text-[13px] font-semibold text-[var(--color-text)]">
          {t.name}
        </span>
        <span className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-3)]">
          {t.category} · {t.workflowCount} wf
        </span>
      </div>
      <span className="font-mono text-[11.5px] leading-relaxed text-[var(--color-text-2)]">
        {t.description}
      </span>
    </button>
  );
}

function BindingRow({
  alias,
  isBoard,
  binding,
  credentials,
  connections,
  onChange,
}: {
  alias: string;
  isBoard: boolean;
  binding: TemplateBinding | undefined;
  credentials: CredentialRow[];
  connections: ConnectionRow[];
  onChange: (b: TemplateBinding) => void;
}) {
  const mode = binding?.mode ?? 'new';
  const eligibleConnections = isBoard
    ? connections.filter((c) => c.scope.kind === 'github_projects_v2')
    : connections.filter(
        (c) => c.scope.kind === 'github_repo' || c.scope.kind === 'gitlab_project',
      );

  const handleNewClick = () => {
    const credId =
      (binding?.mode === 'new' ? binding.credentialId : '') ||
      credentials[0]?.id ||
      '';
    if (isBoard) {
      onChange(newBindingForBoard(alias, credId));
    } else {
      const platform = credentialPlatform(credId, credentials);
      onChange(newBindingForRepo(alias, credId, platform));
    }
  };

  return (
    <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] p-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[12px] text-[var(--color-text)]">
          <span className="text-[var(--color-claude)]">&lt;{alias}&gt;</span>{' '}
          <span className="text-[var(--color-text-3)]">
            connection{isBoard ? ' · optional' : ''}
          </span>
        </div>
        <div className="flex gap-1 rounded-md border border-[var(--color-line)] p-0.5">
          <ModeButton active={mode === 'new'} onClick={handleNewClick}>
            New
          </ModeButton>
          <ModeButton
            active={mode === 'existing'}
            onClick={() =>
              onChange({
                mode: 'existing',
                connectionId:
                  binding?.mode === 'existing' ? binding.connectionId : '',
              })
            }
          >
            Existing
          </ModeButton>
        </div>
      </div>

      {binding?.mode === 'new' && (
        <NewBindingFields
          isBoard={isBoard}
          binding={binding}
          credentials={credentials}
          onChange={onChange}
        />
      )}

      {binding?.mode === 'existing' && (
        <div className="mt-3">
          <LabeledSelect
            label="Connection"
            value={binding.connectionId}
            onChange={(v) => onChange({ ...binding, connectionId: v })}
            placeholder={
              eligibleConnections.length === 0
                ? `No ${isBoard ? 'board' : 'repo'} connections yet`
                : 'Pick one…'
            }
            options={eligibleConnections.map((c) => ({
              value: c.id,
              label: connectionLabel(c),
            }))}
          />
        </div>
      )}
    </div>
  );
}

function NewBindingFields({
  isBoard,
  binding,
  credentials,
  onChange,
}: {
  isBoard: boolean;
  binding: Extract<TemplateBinding, { mode: 'new' }>;
  credentials: CredentialRow[];
  onChange: (b: TemplateBinding) => void;
}) {
  const setScope = (scope: ConnectionScope) => onChange({ ...binding, scope });

  const handleCredentialChange = (credId: string) => {
    if (isBoard) {
      onChange({ ...binding, credentialId: credId });
      return;
    }
    const platform = credentialPlatform(credId, credentials);
    const currentIsGitlab = binding.scope.kind === 'gitlab_project';
    const newIsGitlab = platform === 'GITLAB';
    if (currentIsGitlab !== newIsGitlab) {
      onChange({
        ...binding,
        credentialId: credId,
        scope: defaultRepoScope(platform),
      });
    } else {
      onChange({ ...binding, credentialId: credId });
    }
  };

  return (
    <div className="mt-3 grid grid-cols-2 gap-3">
      <LabeledInput
        label="Name"
        value={binding.name}
        onChange={(v) => onChange({ ...binding, name: v })}
      />
      <LabeledSelect
        label="Credential"
        value={binding.credentialId}
        onChange={handleCredentialChange}
        placeholder={credentials.length === 0 ? 'No credentials yet' : 'Pick one…'}
        options={credentials.map((c) => ({
          value: c.id,
          label: `${c.platform.toLowerCase()} · ${c.name}`,
        }))}
      />

      {binding.scope.kind === 'github_repo' && (
        <GithubRepoScopeFields
          credentialId={binding.credentialId}
          scope={binding.scope}
          setScope={setScope}
        />
      )}

      {binding.scope.kind === 'gitlab_project' && (
        <GitlabProjectScopeFields
          credentialId={binding.credentialId}
          scope={binding.scope}
          setScope={setScope}
        />
      )}

      {binding.scope.kind === 'github_projects_v2' && (
        <BoardScopeFields
          credentialId={binding.credentialId}
          scope={binding.scope}
          setScope={setScope}
        />
      )}
    </div>
  );
}

function GithubRepoScopeFields({
  credentialId,
  scope,
  setScope,
}: {
  credentialId: string;
  scope: Extract<ConnectionScope, { kind: 'github_repo' }>;
  setScope: (s: ConnectionScope) => void;
}) {
  const reposQuery = useListViewerRepos({
    credentialId,
    enabled: !!credentialId,
  });
  const repos = (reposQuery.data ?? []) as Array<{ owner: string; name: string }>;
  const options = useMemo(
    () =>
      repos.map((r) => {
        const full = `${r.owner}/${r.name}`;
        return { value: full, label: full };
      }),
    [repos],
  );
  const selected = scope.owner && scope.repo ? `${scope.owner}/${scope.repo}` : '';

  if (repos.length > 0) {
    return (
      <div className="col-span-2">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-3)]">
            Repository
          </span>
          <SearchSelect
            ariaLabel="Repository"
            value={selected}
            onValueChange={(v) => {
              const slash = v.indexOf('/');
              if (slash > 0) setScope({ ...scope, owner: v.slice(0, slash), repo: v.slice(slash + 1) });
            }}
            placeholder={reposQuery.isFetching ? 'Loading…' : '— pick a repo —'}
            options={options}
          />
        </label>
      </div>
    );
  }

  return (
    <>
      <LabeledInput
        label="Owner"
        value={scope.owner}
        onChange={(v) => setScope({ ...scope, owner: v })}
      />
      <LabeledInput
        label="Repo"
        value={scope.repo}
        onChange={(v) => setScope({ ...scope, repo: v })}
      />
    </>
  );
}

function GitlabProjectScopeFields({
  credentialId,
  scope,
  setScope,
}: {
  credentialId: string;
  scope: Extract<ConnectionScope, { kind: 'gitlab_project' }>;
  setScope: (s: ConnectionScope) => void;
}) {
  const projectsQuery = useListViewerRepos({
    credentialId,
    enabled: !!credentialId,
  });
  const projects = (projectsQuery.data ?? []) as Array<{ path: string }>;
  const options = useMemo(
    () => projects.map((p) => ({ value: p.path, label: p.path })),
    [projects],
  );

  if (projects.length > 0) {
    return (
      <div className="col-span-2">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-3)]">
            Project
          </span>
          <SearchSelect
            ariaLabel="Project"
            value={scope.projectPath}
            onValueChange={(v) => setScope({ ...scope, projectPath: v })}
            placeholder={projectsQuery.isFetching ? 'Loading…' : '— pick a project —'}
            options={options}
          />
        </label>
      </div>
    );
  }

  return (
    <div className="col-span-2">
      <LabeledInput
        label="Project path"
        value={scope.projectPath}
        onChange={(v) => setScope({ ...scope, projectPath: v })}
        placeholder="group/project"
      />
    </div>
  );
}

function BoardScopeFields({
  credentialId,
  scope,
  setScope,
}: {
  credentialId: string;
  scope: Extract<ConnectionScope, { kind: 'github_projects_v2' }>;
  setScope: (s: ConnectionScope) => void;
}) {
  const orgsQuery = useListViewerOrgs({
    credentialId,
    enabled: !!credentialId,
  });
  const orgs = orgsQuery.data ?? [];

  const boardsQuery = useListProjectBoards({
    credentialId,
    ownerType: scope.ownerType,
    owner: scope.owner,
    enabled: !!credentialId && !!scope.owner,
  });
  const boards = boardsQuery.data ?? [];

  return (
    <>
      {orgs.length > 0 ? (
        <LabeledSelect
          label="Owner"
          value={scope.owner}
          onChange={(login) => {
            const entry = orgs.find((o) => o.login === login);
            if (entry) setScope({ ...scope, owner: entry.login, ownerType: entry.ownerType });
          }}
          placeholder="— pick an owner —"
          options={orgs.map((o) => ({
            value: o.login,
            label: o.ownerType === 'user' ? `${o.login} (you)` : o.login,
          }))}
        />
      ) : (
        <>
          <LabeledSelect
            label="Owner type"
            value={scope.ownerType}
            onChange={(v) =>
              setScope({ ...scope, ownerType: v as 'user' | 'org' })
            }
            options={[
              { value: 'org', label: 'Org' },
              { value: 'user', label: 'User' },
            ]}
          />
          <LabeledInput
            label="Owner"
            value={scope.owner}
            onChange={(v) => setScope({ ...scope, owner: v })}
          />
        </>
      )}
      {boards.length > 0 ? (
        <LabeledSelect
          label="Project"
          value={scope.number > 0 ? String(scope.number) : ''}
          onChange={(v) => setScope({ ...scope, number: Number(v) })}
          placeholder="— pick a project —"
          options={boards.map((b) => ({
            value: String(b.number),
            label: `#${b.number} · ${b.title}`,
          }))}
        />
      ) : (
        <LabeledInput
          label="Project #"
          value={scope.number > 0 ? String(scope.number) : ''}
          onChange={(v) => {
            const num = Number(v);
            if (Number.isInteger(num) && num > 0) {
              setScope({ ...scope, number: num });
            }
          }}
        />
      )}
    </>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wider transition-colors ' +
        (active
          ? 'bg-[var(--color-claude)] text-black'
          : 'text-[var(--color-text-2)] hover:text-[var(--color-text)]')
      }
    >
      {children}
    </button>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-3)]">
        {label}
      </span>
      <input
        className="field-input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-3)]">
        {label}
      </span>
      <Select
        ariaLabel={label}
        value={value}
        onValueChange={onChange}
        options={options}
        placeholder={placeholder}
      />
    </label>
  );
}
