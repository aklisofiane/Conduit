import { useCallback } from 'react';
import { X } from 'lucide-react';
import type {
  ConnectionScope,
  TriggerConfig,
  TriggerFilter,
} from '@conduit/shared';
import { isConduitLabel } from '@conduit/shared/label';
import type { ProjectBoardSummary } from '@conduit/shared/platform';
import { ApiError } from '../../api/client.js';
import { useEnsureRepoLabels } from '../../api/hooks.js';
import type { useListProjectBoards } from '../../api/hooks.js';
import { cn } from '../../lib/cn.js';
import { scopeSummary } from '../../lib/connection.js';
import { Select } from '../common/Select.js';

/**
 * Pieces shared across the three typed trigger panels (`IssuesTriggerPanel`,
 * `PrTriggerPanel`, `CronTriggerPanel`). Each panel composes these into the
 * specific subset of fields it exposes; field-level rendering rules and
 * common visual chrome (header, footer, Field, ConnectionSelect, filters)
 * live here so the three panels stay focused on what they actually edit.
 */

export interface PanelHeaderProps {
  trigger: TriggerConfig;
  isActive: boolean;
  title: string;
  onClose: () => void;
}

export function PanelHeader({ trigger, isActive, title, onClose }: PanelHeaderProps) {
  return (
    <div className="flex items-start justify-between border-b border-[var(--color-divider)] px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--color-text-muted)]">
          <span
            className={cn(
              'h-[6px] w-[6px] rounded-full',
              isActive ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-muted)]',
            )}
          />
          Trigger · {trigger.platform}
        </div>
        <h3 className="mt-2 truncate font-sans text-[15px] font-semibold text-[var(--color-text)]">
          <span>{title}</span>
          <span className="text-[var(--color-text-muted)]"> · config</span>
        </h3>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close inspector"
        className="ml-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-pill-bg)] hover:text-[var(--color-text)]"
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}

export interface PanelFooterProps {
  saving: boolean;
  dirty: boolean;
  valid?: boolean;
  onSave: () => void;
  onDiscard: () => void;
}

export function PanelFooter({ saving, dirty, valid = true, onSave, onDiscard }: PanelFooterProps) {
  return (
    <div className="flex gap-2 border-t border-[var(--color-divider)] bg-[var(--color-bg-panel)] px-5 py-4">
      <button className="btn flex-1" onClick={onDiscard} disabled={!dirty}>
        Discard
      </button>
      <button className="btn primary flex-1" onClick={onSave} disabled={!dirty || saving || !valid}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="field-label">
        {label}
        {hint && <span className="hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function Hint({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode;
  tone?: 'muted' | 'danger';
}) {
  return (
    <div
      className={cn(
        'font-mono text-[11px]',
        tone === 'danger'
          ? 'text-[var(--color-danger,#d54c4c)]'
          : 'text-[var(--color-text-muted)]',
      )}
    >
      {children}
    </div>
  );
}

export function ConnectionSelect({
  connections,
  value,
  onChange,
  emptyHint,
}: {
  connections: { id: string; name: string; scope: ConnectionScope }[];
  value: string;
  onChange: (id: string) => void;
  emptyHint: string;
}) {
  if (connections.length === 0) {
    return (
      <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
        {emptyHint}
      </div>
    );
  }
  return (
    <Select
      ariaLabel="Connection"
      placeholder="— select a connection —"
      value={value}
      onValueChange={onChange}
      options={connections.map((c) => {
        const summary = scopeSummary(c.scope);
        return {
          value: c.id,
          label: summary ? `${c.name} · ${summary}` : c.name,
        };
      })}
    />
  );
}

export function ActiveToggleField({
  isActive,
  onActiveChange,
}: {
  isActive: boolean;
  onActiveChange: (next: boolean) => void;
}) {
  return (
    <Field label="Active" hint="pause the trigger without deleting it — saves immediately">
      <label className="flex cursor-pointer items-center gap-2 font-mono text-[12px]">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => onActiveChange(e.target.checked)}
        />
        <span>{isActive ? 'active — receiving events' : 'paused'}</span>
      </label>
    </Field>
  );
}

const FIELD_LABELS: Record<TriggerFilter['field'], string> = {
  status: 'Status',
  label: 'Label',
  pr_state: 'PR state',
};

function emptyFilter(field: TriggerFilter['field']): TriggerFilter {
  if (field === 'pr_state') return { field: 'pr_state', value: 'any' };
  return { field, value: '' };
}

/**
 * The repo/project a missing `conduit-*` label can be created on. Threaded
 * down to the label filter's value input so it can offer an inline "create
 * label" action. Undefined when no repo/project connection is selected.
 */
export interface EnsureLabelTarget {
  connectionId: string;
  /** Display string for the button, e.g. `owner/repo` or a GitLab path. */
  scopeLabel: string;
}

/**
 * Build the create-label target for the selected connection — present only
 * when the connection is bound to a repo/project (labels live there).
 */
export function ensureLabelTarget(
  connections: { id: string; name: string; scope: ConnectionScope }[],
  connectionId: string,
): EnsureLabelTarget | undefined {
  const conn = connections.find((c) => c.id === connectionId);
  if (
    !conn ||
    (conn.scope.kind !== 'github_repo' && conn.scope.kind !== 'gitlab_project')
  ) {
    return undefined;
  }
  return {
    connectionId: conn.id,
    scopeLabel: scopeSummary(conn.scope) || conn.name,
  };
}

export function FilterEditor({
  filters,
  offeredFields,
  statusOptions,
  labelOptions,
  ensureTarget,
  onChange,
}: {
  filters: TriggerFilter[];
  offeredFields: Array<TriggerFilter['field']>;
  statusOptions: string[];
  labelOptions: string[];
  ensureTarget?: EnsureLabelTarget;
  onChange: (filters: TriggerFilter[]) => void;
}) {
  const replaceAt = useCallback(
    (i: number, next: TriggerFilter) =>
      onChange(filters.map((f, idx) => (idx === i ? next : f))),
    [filters, onChange],
  );
  const removeAt = useCallback(
    (i: number) => onChange(filters.filter((_, idx) => idx !== i)),
    [filters, onChange],
  );
  const add = useCallback(
    () => onChange([...filters, emptyFilter(offeredFields[0]!)]),
    [filters, offeredFields, onChange],
  );

  return (
    <div className="space-y-2">
      {filters.length === 0 && (
        <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
          No filters — every matching event fires the workflow.
        </div>
      )}
      {filters.map((f, i) => (
        <FilterRow
          key={i}
          filter={f}
          offeredFields={offeredFields}
          statusOptions={statusOptions}
          labelOptions={labelOptions}
          ensureTarget={ensureTarget}
          onReplace={(next) => replaceAt(i, next)}
          onRemove={() => removeAt(i)}
        />
      ))}
      <button className="btn w-full" onClick={add}>
        + Add filter
      </button>
    </div>
  );
}

function FilterRow({
  filter,
  offeredFields,
  statusOptions,
  labelOptions,
  ensureTarget,
  onReplace,
  onRemove,
}: {
  filter: TriggerFilter;
  offeredFields: Array<TriggerFilter['field']>;
  statusOptions: string[];
  labelOptions: string[];
  ensureTarget?: EnsureLabelTarget;
  onReplace: (next: TriggerFilter) => void;
  onRemove: () => void;
}) {
  const setKind = (next: TriggerFilter['field']) => {
    if (next === filter.field) return;
    onReplace(emptyFilter(next));
  };

  const fieldDropdownOptions = offeredFields.includes(filter.field)
    ? offeredFields
    : [filter.field, ...offeredFields];

  return (
    <div className="grid grid-cols-[100px_1fr_28px] gap-1.5 rounded-[var(--radius)] border border-[var(--color-divider)] bg-[var(--color-pill-bg)] p-1.5">
      <Select
        ariaLabel="Filter field"
        value={filter.field}
        onValueChange={(v) => setKind(v as TriggerFilter['field'])}
        options={fieldDropdownOptions.map((f) => ({
          value: f,
          label: FIELD_LABELS[f],
        }))}
      />
      {filter.field === 'status' && (
        <OptionsValueInput
          value={filter.value}
          options={statusOptions}
          emptyHint="(pick a board to load Status options)"
          onChange={(value) => onReplace({ field: 'status', value })}
        />
      )}
      {filter.field === 'label' && (
        <OptionsValueInput
          value={filter.value}
          options={labelOptions}
          emptyHint="(no labels — pick a connection bound to a repo)"
          ensureTarget={ensureTarget}
          onChange={(value) => onReplace({ field: 'label', value })}
        />
      )}
      {filter.field === 'pr_state' && (
        <Select
          ariaLabel="PR state"
          value={filter.value}
          onValueChange={(v) =>
            onReplace({
              field: 'pr_state',
              value: v as 'draft' | 'ready_for_review' | 'any',
            })
          }
          options={[
            { value: 'any', label: 'Any state' },
            { value: 'draft', label: 'Draft only' },
            { value: 'ready_for_review', label: 'Ready for review only' },
          ]}
        />
      )}
      <button
        className="btn"
        onClick={onRemove}
        aria-label="Remove filter"
        title="Remove filter"
      >
        ×
      </button>
    </div>
  );
}

function OptionsValueInput({
  value,
  options,
  emptyHint,
  ensureTarget,
  onChange,
}: {
  value: string;
  options: string[];
  emptyHint: string;
  ensureTarget?: EnsureLabelTarget;
  onChange: (next: string) => void;
}) {
  if (options.length === 0) {
    return (
      <input
        className="field-input"
        placeholder={emptyHint}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  const items = options.map((opt) => ({ value: opt, label: opt }));
  const unmatched = value !== '' && !options.includes(value);
  if (unmatched) {
    items.unshift({ value, label: `${value} (not found)` });
  }
  // A missing value that's one of *our* labels is fixable in place: offer to
  // create it on the connection's repo/project rather than leaving a dead
  // "(not found)" string. Non-Conduit unmatched values keep the plain text.
  const showCreate = unmatched && !!ensureTarget && isConduitLabel(value);
  return (
    <div className="space-y-1.5">
      <Select
        placeholder="— select —"
        value={value}
        onValueChange={onChange}
        options={items}
      />
      {showCreate && (
        <CreateLabelAction
          name={value}
          target={ensureTarget}
        />
      )}
    </div>
  );
}

function CreateLabelAction({
  name,
  target,
}: {
  name: string;
  target: EnsureLabelTarget;
}) {
  const ensure = useEnsureRepoLabels();
  // On success the hook invalidates the labels query; the dropdown re-resolves
  // and this whole affordance unmounts (the value is now a matched option).
  const result = ensure.data?.[0];
  const failed = result?.status === 'failed';
  const errorText = ensure.error
    ? ensure.error instanceof ApiError
      ? ensure.error.message
      : String(ensure.error)
    : failed
      ? (result?.error ?? 'Failed to create label')
      : null;

  return (
    <div className="rounded-[var(--radius)] border border-[var(--color-warning,#b58900)]/40 bg-[var(--color-warning,#b58900)]/10 px-2 py-1.5">
      <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
        Label{' '}
        <code className="text-[var(--color-text)]">{name}</code> isn't on{' '}
        <code className="text-[var(--color-text)]">{target.scopeLabel}</code> yet.
      </div>
      <button
        type="button"
        className="btn mt-1.5"
        disabled={ensure.isPending}
        onClick={() =>
          ensure.mutate({ connectionId: target.connectionId, names: [name] })
        }
      >
        {ensure.isPending
          ? 'Creating…'
          : `+ Create "${name}" on ${target.scopeLabel}`}
      </button>
      {errorText && (
        <div className="mt-1 font-mono text-[11px] text-[var(--color-danger,#dc322f)]">
          {errorText}
        </div>
      )}
    </div>
  );
}

export function BoardPickerHint({
  query,
  selectedBoard,
}: {
  query: ReturnType<typeof useListProjectBoards>;
  selectedBoard: ProjectBoardSummary;
}) {
  if (query.error) {
    const message = query.error instanceof ApiError ? query.error.message : String(query.error);
    return <Hint tone="danger">{message}</Hint>;
  }
  return (
    <div className="space-y-1.5">
      <div className="font-mono text-[12px] text-[var(--color-text)]">
        #{selectedBoard.number} · {selectedBoard.title}
      </div>
      <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
        <a
          href={selectedBoard.url}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--color-accent)] hover:underline"
        >
          open on github ↗
        </a>
        {selectedBoard.fields.length > 0 && (
          <span>
            {' · '}
            {selectedBoard.fields.length} single-select field
            {selectedBoard.fields.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
    </div>
  );
}
