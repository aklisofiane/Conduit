import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client.js';
import {
  useCreateFromTemplate,
  useCredentials,
  useTemplates,
} from '../../api/hooks.js';
import type {
  CredentialRow,
  TemplateBinding,
  TemplateSummary,
} from '../../api/types.js';

export function TemplatePickerDialog({ onClose }: { onClose: () => void }) {
  const { data: templates = [], isLoading } = useTemplates();
  const { data: credentials = [] } = useCredentials();
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
      return Boolean(b.alias && b.credentialId);
    });

  const handlePick = (t: TemplateSummary) => {
    setSelected(t);
    setBindings(
      Object.fromEntries(
        t.placeholders.map<[string, TemplateBinding]>((alias) => [
          alias,
          { mode: 'new', alias, credentialId: credentials[0]?.id ?? '' },
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
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create workflow from template"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(9,9,11,0.65)] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-[680px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-bg-1)]"
        onClick={(e) => e.stopPropagation()}
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
      </div>
    </div>
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
  binding,
  credentials,
  onChange,
}: {
  alias: string;
  binding: TemplateBinding | undefined;
  credentials: CredentialRow[];
  onChange: (b: TemplateBinding) => void;
}) {
  const mode = binding?.mode ?? 'new';

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
              onChange({
                mode: 'new',
                alias,
                credentialId:
                  (binding?.mode === 'new' ? binding.credentialId : '') ||
                  credentials[0]?.id ||
                  '',
              })
            }
          >
            New
          </ModeButton>
          <ModeButton
            active={mode === 'existing'}
            onClick={() =>
              onChange({
                mode: 'existing',
                connectionId: binding?.mode === 'existing' ? binding.connectionId : '',
              })
            }
          >
            Existing
          </ModeButton>
        </div>
      </div>

      {binding?.mode === 'new' && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <LabeledInput
            label="Alias"
            value={binding.alias}
            onChange={(v) => onChange({ ...binding, alias: v })}
          />
          <LabeledSelect
            label="Credential"
            value={binding.credentialId}
            onChange={(v) => onChange({ ...binding, credentialId: v })}
          >
            <option value="" disabled>
              {credentials.length === 0 ? 'No credentials yet' : 'Pick one…'}
            </option>
            {credentials.map((c) => (
              <option key={c.id} value={c.id}>
                {c.platform.toLowerCase()} · {c.name}
              </option>
            ))}
          </LabeledSelect>
          <LabeledInput
            label="Owner (optional)"
            value={binding.owner ?? ''}
            onChange={(v) => onChange({ ...binding, owner: v || undefined })}
          />
          <LabeledInput
            label="Repo (optional)"
            value={binding.repo ?? ''}
            onChange={(v) => onChange({ ...binding, repo: v || undefined })}
          />
        </div>
      )}

      {binding?.mode === 'existing' && (
        <div className="mt-3">
          <LabeledInput
            label="Connection ID"
            value={binding.connectionId}
            onChange={(v) => onChange({ ...binding, connectionId: v })}
            placeholder="paste an existing WorkflowConnection id"
          />
        </div>
      )}
    </div>
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
        className="input"
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
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-3)]">
        {label}
      </span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}
