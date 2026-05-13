import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ConnectionScope } from '@conduit/shared';
import { ApiError } from '../../api/client.js';
import {
  useConnections,
  useCreateFromTemplate,
  useCredentials,
  useTemplates,
} from '../../api/hooks.js';
import type {
  ConnectionRow,
  CredentialRow,
  TemplateBinding,
  TemplateSummary,
} from '../../api/types.js';
import { connectionLabel } from '../../lib/connection.js';
import { Dialog, DialogContent } from '../common/Dialog.js';
import { Select, type SelectOption } from '../common/Select.js';

export function TemplatePickerDialog({ onClose }: { onClose: () => void }) {
  const { data: templates = [], isLoading } = useTemplates();
  const { data: credentials = [] } = useCredentials();
  const { data: connections = [] } = useConnections();
  const createFromTemplate = useCreateFromTemplate();
  const navigate = useNavigate();

  const [selected, setSelected] = useState<TemplateSummary | null>(null);
  const [bindings, setBindings] = useState<Record<string, TemplateBinding>>({});
  const [error, setError] = useState<string | null>(null);

  const canCreate =
    !!selected &&
    selected.placeholders.every((p) => {
      const b = bindings[p];
      if (!b) return false;
      if (b.mode === 'existing') return Boolean(b.connectionId);
      return Boolean(b.name && b.credentialId && b.scope);
    });

  const handlePick = (t: TemplateSummary) => {
    setSelected(t);
    setBindings(
      Object.fromEntries(
        t.placeholders.map<[string, TemplateBinding]>((alias) => [
          alias,
          defaultBindingForAlias(alias, credentials, connections),
        ]),
      ),
    );
    setError(null);
  };

  const handleCreate = async () => {
    if (!selected) return;
    setError(null);
    try {
      const result = await createFromTemplate.mutateAsync({
        templateId: selected.id,
        bindings,
      });
      onClose();
      if (result.workflows[0]) {
        navigate(`/workflows/${result.workflows[0].id}`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        aria-label="Create workflow from template"
        className="flex max-h-[85vh] w-[680px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-bg-1)] p-0 shadow-none"
      >
        <header className="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-4">
          <div>
            <h2
              className="text-[22px] font-semibold tracking-tight text-[var(--color-text)]"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              {selected ? `Configure ${selected.name}` : 'Start from a template'}
            </h2>
            <p className="mt-0.5 font-mono text-[11px] text-[var(--color-text-3)]">
              {selected
                ? `${selected.workflowCount} workflow${selected.workflowCount === 1 ? '' : 's'} · ${selected.placeholders.length} connection${selected.placeholders.length === 1 ? '' : 's'} to bind`
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
              {selected.placeholders.length === 0 ? (
                <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-3 py-2 font-mono text-[12px] text-[var(--color-text-2)]">
                  No connection bindings needed.
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {selected.placeholders.map((alias) => (
                    <BindingRow
                      key={alias}
                      alias={alias}
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

/**
 * Map a placeholder alias to a sensible default scope. Aliases follow the
 * `<github-repo>` / `<github-board>` convention; anything else falls back
 * to `github_repo` until templates demand richer kinds.
 */
function defaultScopeForAlias(alias: string): ConnectionScope {
  if (/board/.test(alias)) {
    return { kind: 'github_projects_v2', ownerType: 'org', owner: '', number: 1 };
  }
  return { kind: 'github_repo', owner: '', repo: '' };
}

function newBindingForAlias(alias: string, credentialId: string): TemplateBinding {
  return {
    mode: 'new',
    name: alias,
    credentialId,
    scope: defaultScopeForAlias(alias),
  };
}

function defaultBindingForAlias(
  alias: string,
  credentials: CredentialRow[],
  connections: ConnectionRow[],
): TemplateBinding {
  const expectedKind = defaultScopeForAlias(alias).kind;
  const eligible = connections.filter((c) => c.scope.kind === expectedKind);
  const only = eligible.length === 1 ? eligible[0] : undefined;
  if (eligible.length > 0) {
    return { mode: 'existing', connectionId: only?.id ?? '' };
  }
  return newBindingForAlias(alias, credentials[0]?.id ?? '');
}

function BindingRow({
  alias,
  binding,
  credentials,
  connections,
  onChange,
}: {
  alias: string;
  binding: TemplateBinding | undefined;
  credentials: CredentialRow[];
  connections: ConnectionRow[];
  onChange: (b: TemplateBinding) => void;
}) {
  const mode = binding?.mode ?? 'new';
  const expectedKind = defaultScopeForAlias(alias).kind;
  const eligibleConnections = connections.filter(
    (c) => c.scope.kind === expectedKind,
  );

  return (
    <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] p-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[12px] text-[var(--color-text)]">
          <span className="text-[var(--color-claude)]">&lt;{alias}&gt;</span>{' '}
          <span className="text-[var(--color-text-3)]">connection</span>
        </div>
        <div className="flex gap-1 rounded-md border border-[var(--color-line)] p-0.5">
          <ModeButton
            active={mode === 'new'}
            onClick={() =>
              onChange(
                newBindingForAlias(
                  alias,
                  (binding?.mode === 'new' ? binding.credentialId : '') ||
                    credentials[0]?.id ||
                    '',
                ),
              )
            }
          >
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
                ? `No ${expectedKind} connections yet`
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
  binding,
  credentials,
  onChange,
}: {
  binding: Extract<TemplateBinding, { mode: 'new' }>;
  credentials: CredentialRow[];
  onChange: (b: TemplateBinding) => void;
}) {
  const setScope = (scope: ConnectionScope) => onChange({ ...binding, scope });
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
        onChange={(v) => onChange({ ...binding, credentialId: v })}
        placeholder={credentials.length === 0 ? 'No credentials yet' : 'Pick one…'}
        options={credentials.map((c) => ({
          value: c.id,
          label: `${c.platform.toLowerCase()} · ${c.name}`,
        }))}
      />

      {binding.scope.kind === 'github_repo' && (
        <RepoScopeFields scope={binding.scope} setScope={setScope} />
      )}

      {binding.scope.kind === 'github_projects_v2' && (
        <BoardScopeFields scope={binding.scope} setScope={setScope} />
      )}
    </div>
  );
}

function RepoScopeFields({
  scope,
  setScope,
}: {
  scope: Extract<ConnectionScope, { kind: 'github_repo' }>;
  setScope: (s: ConnectionScope) => void;
}) {
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

function BoardScopeFields({
  scope,
  setScope,
}: {
  scope: Extract<ConnectionScope, { kind: 'github_projects_v2' }>;
  setScope: (s: ConnectionScope) => void;
}) {
  return (
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
      <LabeledInput
        label="Project #"
        value={String(scope.number)}
        onChange={(v) => {
          const num = Number(v);
          if (Number.isInteger(num) && num > 0) {
            setScope({ ...scope, number: num });
          }
        }}
      />
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
