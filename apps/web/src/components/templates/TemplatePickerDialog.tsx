import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ConnectionScope } from '@conduit/shared';
import { summarizeTemplate, templateFileSchema, type TemplateFile } from '@conduit/shared/template';
import { Upload } from 'lucide-react';
import { ApiError } from '../../api/client.js';
import {
  useConnections,
  useCreateFromTemplate,
  useCredentials,
  useImportTemplate,
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
import { connectionLabel, repoScopedConnections } from '../../lib/connection.js';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog.js';
import { SearchSelect } from '../ui/search-select.js';
import { Select, type SelectOption } from '../ui/select.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { SelectableCard } from '../ui/selectable-card.js';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group.js';

function credentialPlatform(
  credentialId: string,
  credentials: CredentialRow[],
): 'GITHUB' | 'GITLAB' | undefined {
  const cred = credentials.find((c) => c.id === credentialId);
  if (!cred) return undefined;
  return cred.platform === 'GITLAB' ? 'GITLAB' : 'GITHUB';
}

/**
 * Resolve the platform a single binding targets: for `new` bindings via its
 * credential, for `existing` bindings via the bound connection's credential.
 * Undefined when the binding is empty or unresolvable.
 */
function getPlatformForBinding(
  binding: TemplateBinding | undefined,
  credentials: CredentialRow[],
  connections: ConnectionRow[],
): 'GITHUB' | 'GITLAB' | undefined {
  if (!binding) return undefined;
  if (binding.mode === 'new') {
    return credentialPlatform(binding.credentialId, credentials);
  }
  const conn = connections.find((c) => c.id === binding.connectionId);
  if (!conn) return undefined;
  return conn.credential.platform === 'GITLAB' ? 'GITLAB' : 'GITHUB';
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
  const eligible = repoScopedConnections(connections);
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
  const eligible = connections.filter((c) => c.scope.kind === 'github_projects_v2');
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
  const importTemplate = useImportTemplate();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selected, setSelected] = useState<TemplateSummary | null>(null);
  // Set when the selection came from an uploaded file rather than the catalog;
  // drives the create branch (import endpoint vs catalog endpoint).
  const [importedFile, setImportedFile] = useState<TemplateFile | null>(null);
  const [bindings, setBindings] = useState<Record<string, TemplateBinding>>({});
  const [error, setError] = useState<string | null>(null);

  const pending = createFromTemplate.isPending || importTemplate.isPending;

  const boardAliasSet = useMemo(() => new Set(selected?.boardAliases ?? []), [selected]);
  const repoAliases = useMemo(
    () => (selected?.placeholders ?? []).filter((p) => !boardAliasSet.has(p)),
    [selected, boardAliasSet],
  );
  const boardAlias = selected?.boardAliases?.[0];

  // GITHUB wins outright; otherwise the first resolvable platform across the
  // repo bindings (board scope only applies to GitHub).
  const repoPlatform = useMemo(() => {
    let found: 'GITHUB' | 'GITLAB' | undefined;
    for (const alias of repoAliases) {
      const p = getPlatformForBinding(bindings[alias], credentials, connections);
      if (p === 'GITHUB') return 'GITHUB' as const;
      if (p) found = p;
    }
    return found;
  }, [repoAliases, bindings, credentials, connections]);
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

  const selectSummary = (t: TemplateSummary) => {
    setSelected(t);
    const boards = new Set(t.boardAliases);
    setBindings(
      Object.fromEntries(
        t.placeholders
          .filter((alias) => !boards.has(alias))
          .map<
            [string, TemplateBinding]
          >((alias) => [alias, defaultBindingForRepo(alias, credentials, connections)]),
      ),
    );
    setError(null);
  };

  const handlePick = (t: TemplateSummary) => {
    setImportedFile(null);
    selectSummary(t);
  };

  const handleBack = () => {
    setSelected(null);
    setImportedFile(null);
  };

  const handleImportFile = async (file: File) => {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setError('Not a valid workflow export.');
      return;
    }
    const result = templateFileSchema.safeParse(parsed);
    if (!result.success) {
      setError('Not a valid workflow export.');
      return;
    }
    setImportedFile(result.data);
    // The server re-derives placeholders authoritatively at create time; this
    // client-side summary just drives the binding form.
    selectSummary(summarizeTemplate(result.data));
  };

  const handleCreate = async () => {
    if (!selected) return;
    setError(null);
    const finalBindings = { ...bindings };
    if (boardAlias && !showBoard) {
      delete finalBindings[boardAlias];
    }
    try {
      const result = importedFile
        ? await importTemplate.mutateAsync({
            template: importedFile,
            bindings: finalBindings,
          })
        : await createFromTemplate.mutateAsync({
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
      <DialogContent className="flex max-h-[85vh] w-[680px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-[var(--color-divider)] bg-[var(--color-bg-panel)] p-0 shadow-none">
        <header className="flex items-center justify-between border-b border-[var(--color-divider)] px-5 py-4">
          <div>
            <DialogTitle
              className="text-[22px] font-semibold tracking-tight text-[var(--color-text)]"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              {selected ? `Configure ${selected.name}` : 'Start from a template'}
            </DialogTitle>
            <p className="mt-0.5 font-mono text-[11px] text-[var(--color-text-muted)]">
              {selected
                ? `${selected.workflowCount} workflow${selected.workflowCount === 1 ? '' : 's'} · ${orderedAliases.length} connection${orderedAliases.length === 1 ? '' : 's'} to bind`
                : 'Pre-built workflow blueprints you can copy and edit.'}
            </p>
          </div>
          <Button onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!selected && (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-dashed border-[var(--color-divider)] bg-[var(--color-pill-bg)] px-4 py-3">
              <div className="font-mono text-[11.5px] text-[var(--color-text-2)]">
                Have a workflow export? Import a <code>.json</code> bundle.
              </div>
              <Button type="button" onClick={() => fileInputRef.current?.click()}>
                <Upload size={12} strokeWidth={1.5} />
                Import from file
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void handleImportFile(file);
                }}
              />
            </div>
          )}

          {isLoading && (
            <div className="font-mono text-[12px] text-[var(--color-text-muted)]">
              Loading templates…
            </div>
          )}

          {!selected && !isLoading && templates.length === 0 && (
            <div className="font-mono text-[12px] text-[var(--color-text-muted)]">
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
              <div className="flex flex-col gap-2">
                {selected.description.split('\n\n').map((para, i) => (
                  <p
                    key={i}
                    className="font-mono text-[12px] leading-relaxed text-[var(--color-text-2)]"
                  >
                    {para}
                  </p>
                ))}
              </div>
              {orderedAliases.length === 0 ? (
                <div className="rounded-md border border-[var(--color-divider)] bg-[var(--color-pill-bg)] px-3 py-2 font-mono text-[12px] text-[var(--color-text-2)]">
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
                      onChange={(b) => setBindings((prev) => ({ ...prev, [alias]: b }))}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-[var(--color-divider)] px-5 py-3">
          {error ? (
            <div className="font-mono text-[11px] text-[var(--color-danger)]">{error}</div>
          ) : (
            <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
              Workflows are created paused — review + activate on the canvas.
            </div>
          )}
          <div className="flex items-center gap-2">
            {selected && (
              <Button onClick={handleBack} disabled={pending}>
                ← Back
              </Button>
            )}
            <Button
              variant="primary"
              onClick={handleCreate}
              disabled={!selected || !canCreate || pending}
            >
              {pending
                ? 'Creating…'
                : selected
                  ? `Create ${selected.workflowCount === 1 ? 'workflow' : `${selected.workflowCount} workflows`}`
                  : 'Pick a template'}
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function TemplateCard({ t, onPick }: { t: TemplateSummary; onPick: (t: TemplateSummary) => void }) {
  return (
    <SelectableCard
      onClick={() => onPick(t)}
      className="flex flex-col items-start gap-1 rounded-lg bg-[var(--color-pill-bg)] px-4 py-3 hover:border-[var(--color-claude-mark)]"
    >
      <div className="flex w-full items-center justify-between">
        <span className="font-mono text-[13px] font-semibold text-[var(--color-text)]">
          {t.name}
        </span>
        <span className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-muted)]">
          {t.category} · {t.workflowCount} wf
        </span>
      </div>
      <span className="line-clamp-2 font-mono text-[11.5px] leading-relaxed text-[var(--color-text-2)]">
        {t.description.split('\n\n')[0]}
      </span>
    </SelectableCard>
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
    : repoScopedConnections(connections);

  const handleNewClick = () => {
    const credId =
      (binding?.mode === 'new' ? binding.credentialId : '') || credentials[0]?.id || '';
    if (isBoard) {
      onChange(newBindingForBoard(alias, credId));
    } else {
      const platform = credentialPlatform(credId, credentials);
      onChange(newBindingForRepo(alias, credId, platform));
    }
  };

  return (
    <div className="rounded-md border border-[var(--color-divider)] bg-[var(--color-pill-bg)] p-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[12px] text-[var(--color-text)]">
          <span className="text-[var(--color-claude-mark)]">&lt;{alias}&gt;</span>{' '}
          <span className="text-[var(--color-text-muted)]">
            connection{isBoard ? ' · optional' : ''}
          </span>
        </div>
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(v) => {
            if (v === 'new') handleNewClick();
            else if (v === 'existing')
              onChange({
                mode: 'existing',
                connectionId: binding?.mode === 'existing' ? binding.connectionId : '',
              });
          }}
          variant="subtle"
          size="sm"
          className="rounded-md border border-[var(--color-divider)] p-0.5"
        >
          <ToggleGroupItem
            value="new"
            className="uppercase tracking-wider data-[state=on]:bg-[var(--color-claude-mark)] data-[state=on]:text-black"
          >
            New
          </ToggleGroupItem>
          <ToggleGroupItem
            value="existing"
            className="uppercase tracking-wider data-[state=on]:bg-[var(--color-claude-mark)] data-[state=on]:text-black"
          >
            Existing
          </ToggleGroupItem>
        </ToggleGroup>
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
          <span className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-muted)]">
            Repository
          </span>
          <SearchSelect
            ariaLabel="Repository"
            value={selected}
            onValueChange={(v) => {
              const slash = v.indexOf('/');
              if (slash > 0)
                setScope({ ...scope, owner: v.slice(0, slash), repo: v.slice(slash + 1) });
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
          <span className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-muted)]">
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
            onChange={(v) => setScope({ ...scope, ownerType: v as 'user' | 'org' })}
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
      <span className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-muted)]">
        {label}
      </span>
      <Input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
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
      <span className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-muted)]">
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
