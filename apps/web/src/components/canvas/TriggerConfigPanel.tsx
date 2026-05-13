import { useCallback, useMemo } from 'react';
import { offeredFilterFields } from '@conduit/shared';
import type { ConnectionScope, TriggerConfig, TriggerFilter } from '@conduit/shared';
import type { ProjectBoardSummary } from '@conduit/shared/platform';
import {
  useConnections,
  useListLabels,
  useListProjectBoards,
} from '../../api/hooks.js';
import { ApiError } from '../../api/client.js';
import { cn } from '../../lib/cn.js';
import { scopeSummary } from '../../lib/connection.js';
import type { CredentialRow } from '../../api/types.js';
import { Select } from '../common/Select.js';
import { Icon } from './Icon.js';

interface TriggerConfigPanelProps {
  trigger: TriggerConfig;
  isActive: boolean;
  onChange: (patch: Partial<TriggerConfig>) => void;
  onActiveChange: (next: boolean) => void;
  onSave: () => void;
  onDiscard: () => void;
  onClose: () => void;
  saving: boolean;
  dirty: boolean;
}

const TYPE_LABELS: Record<TriggerConfig['type'], string> = {
  issues: 'issues',
  pull_requests: 'pull requests',
  webhook: 'webhook',
};

export function TriggerConfigPanel({
  trigger,
  isActive,
  onChange,
  onActiveChange,
  onSave,
  onDiscard,
  onClose,
  saving,
  dirty,
}: TriggerConfigPanelProps) {
  const platform = trigger.platform.toUpperCase() as CredentialRow['platform'];
  const { data: allConnections = [] } = useConnections();
  const repoConnections = useMemo(
    () =>
      allConnections.filter(
        (c) => c.scope.kind === 'github_repo' && c.credential.platform === platform,
      ),
    [allConnections, platform],
  );
  const boardConnections = useMemo(
    () =>
      allConnections.filter(
        (c) =>
          c.scope.kind === 'github_projects_v2' && c.credential.platform === platform,
      ),
    [allConnections, platform],
  );

  const hasBoard = !!trigger.boardConnectionId;
  const showsBoardSection = trigger.type === 'issues';

  const selectedBoardConnection = useMemo(
    () => boardConnections.find((c) => c.id === trigger.boardConnectionId),
    [boardConnections, trigger.boardConnectionId],
  );
  const boardScope =
    selectedBoardConnection?.scope.kind === 'github_projects_v2'
      ? selectedBoardConnection.scope
      : undefined;

  const boardsQuery = useListProjectBoards({
    connectionId: trigger.boardConnectionId ?? '',
    ownerType: boardScope?.ownerType ?? 'org',
    owner: boardScope?.owner ?? '',
    enabled:
      showsBoardSection && hasBoard && !!trigger.boardConnectionId && !!boardScope,
  });

  const labelsQuery = useListLabels({
    connectionId: trigger.connectionId,
    enabled: !!trigger.connectionId,
  });

  const selectedBoardSummary = boardsQuery.data?.find(
    (b) => boardScope && b.number === boardScope.number,
  );
  const statusOptions =
    selectedBoardSummary?.fields.find((f) => f.name === 'Status')?.options ?? [];
  const labelOptions = labelsQuery.data?.map((l) => l.name) ?? [];

  const setType = (nextType: 'issues' | 'pull_requests') => {
    if (trigger.type === nextType) return;
    const prevInterval =
      trigger.type === 'issues' || trigger.type === 'pull_requests'
        ? trigger.intervalSec
        : 60;
    if (nextType === 'issues') {
      onChange({
        type: 'issues',
        intervalSec: prevInterval,
        filters: [],
      });
    } else {
      onChange({
        type: 'pull_requests',
        intervalSec: prevInterval,
        filters: [],
        boardConnectionId: undefined,
      });
    }
  };

  return (
    <>
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
            <span>{TYPE_LABELS[trigger.type]}</span>
            <span className="text-[var(--color-text-muted)]"> · config</span>
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="ml-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-pill-bg)] hover:text-[var(--color-text)]"
        >
          <Icon name="close" size={14} color="currentColor" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {trigger.type === 'webhook' ? (
          <div className="space-y-3">
            <div className="rounded-[var(--radius)] border border-[var(--color-divider)] bg-[var(--color-pill-bg)] p-3">
              <div className="font-sans text-[12px] font-medium text-[var(--color-text)]">
                Webhook trigger (no UI yet)
              </div>
              <div className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
                event: {trigger.event}
              </div>
              <div className="mt-2 font-mono text-[11px] text-[var(--color-text-muted)]">
                Convert this trigger by picking Issues or Pull requests below.
              </div>
            </div>
            <Field label="Watch">
              <div className="grid grid-cols-2 gap-2">
                <TypeButton
                  active={false}
                  onClick={() => setType('issues')}
                  label="Issues"
                  hint="board or repo issues"
                />
                <TypeButton
                  active={false}
                  onClick={() => setType('pull_requests')}
                  label="Pull requests"
                  hint="open PRs in the repo"
                />
              </div>
            </Field>
          </div>
        ) : (
          <div className="space-y-5">
            <Field label="Platform">
              <Select
                ariaLabel="Platform"
                value={trigger.platform}
                onValueChange={(v) =>
                  onChange({ platform: v as TriggerConfig['platform'] })
                }
                options={[
                  { value: 'github', label: 'GitHub' },
                  { value: 'gitlab', label: 'GitLab (coming soon)', disabled: true },
                  { value: 'jira', label: 'Jira (coming soon)', disabled: true },
                ]}
              />
            </Field>

            <Field label="Watch" hint="what fires this workflow">
              <div className="grid grid-cols-2 gap-2">
                <TypeButton
                  active={trigger.type === 'issues'}
                  onClick={() => setType('issues')}
                  label="Issues"
                  hint={hasBoard ? 'from a project board' : 'open issues in the repo'}
                />
                <TypeButton
                  active={trigger.type === 'pull_requests'}
                  onClick={() => setType('pull_requests')}
                  label="Pull requests"
                  hint="open PRs in the repo"
                />
              </div>
            </Field>

            <Field label="Repo" hint="source connection for events">
              <ConnectionSelect
                connections={repoConnections}
                value={trigger.connectionId}
                onChange={(id) => onChange({ connectionId: id })}
                emptyHint="No repo connections yet — create one on the Connections page."
              />
            </Field>

            {showsBoardSection && (
              <Field
                label="Board (optional)"
                hint={hasBoard ? 'board attached unlocks the status filter below' : undefined}
              >
                {hasBoard ? (
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <ConnectionSelect
                        connections={boardConnections}
                        value={trigger.boardConnectionId ?? ''}
                        onChange={(id) =>
                          onChange({ boardConnectionId: id || undefined })
                        }
                        emptyHint="No Projects v2 connections yet — create one on the Connections page."
                      />
                    </div>
                    <button
                      type="button"
                      className="btn shrink-0"
                      onClick={() => onChange({ boardConnectionId: undefined })}
                      aria-label="Detach board"
                      title="Detach board"
                    >
                      ×
                    </button>
                  </div>
                ) : boardConnections.length === 0 ? (
                  <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
                    No Projects v2 connections yet — create one on the Connections page.
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn w-full"
                    onClick={() => {
                      const first = boardConnections[0];
                      if (first) onChange({ boardConnectionId: first.id });
                    }}
                  >
                    + Attach a board
                  </button>
                )}
                {hasBoard && selectedBoardSummary && (
                  <div className="mt-2">
                    <BoardPickerHint
                      query={boardsQuery}
                      selectedBoard={selectedBoardSummary}
                    />
                  </div>
                )}
              </Field>
            )}

            <Field label="Poll every" hint="seconds between poll cycles">
              <div className="flex items-center gap-2">
                <input
                  className="field-input"
                  type="number"
                  min={10}
                  step={10}
                  value={trigger.intervalSec}
                  onChange={(e) =>
                    onChange({
                      intervalSec: Math.max(10, Number(e.target.value) || 60),
                    })
                  }
                />
                <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
                  sec
                </span>
              </div>
            </Field>

            <Field label="Active" hint="pause the trigger without deleting it — saves immediately">
              <label className="flex cursor-pointer items-center gap-2 font-mono text-[12px]">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => onActiveChange(e.target.checked)}
                />
                <span>
                  {isActive ? 'active — receiving events' : 'paused'}
                </span>
              </label>
            </Field>

            <Field label="Filters" hint="AND-combined — an event must pass all">
              <FilterEditor
                filters={trigger.filters}
                offeredFields={offeredFilterFields(trigger)}
                statusOptions={statusOptions}
                labelOptions={labelOptions}
                onChange={(filters) => onChange({ filters } as Partial<TriggerConfig>)}
              />
              {trigger.type === 'issues' && !hasBoard && (
                <div className="mt-2 font-mono text-[11px] text-[var(--color-text-muted)]">
                  Only `label` available — attach a board to unlock `status`.
                </div>
              )}
            </Field>
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t border-[var(--color-divider)] bg-[var(--color-bg-panel)] px-5 py-4">
        <button className="btn flex-1" onClick={onDiscard} disabled={!dirty}>
          Discard
        </button>
        <button className="btn primary flex-1" onClick={onSave} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </>
  );
}

function ConnectionSelect({
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

const FIELD_LABELS: Record<TriggerFilter['field'], string> = {
  status: 'Status',
  label: 'Label',
  pr_state: 'PR state',
};

function emptyFilter(field: TriggerFilter['field']): TriggerFilter {
  if (field === 'pr_state') return { field: 'pr_state', value: 'any' };
  return { field, value: '' };
}

function FilterEditor({
  filters,
  offeredFields,
  statusOptions,
  labelOptions,
  onChange,
}: {
  filters: TriggerFilter[];
  offeredFields: Array<TriggerFilter['field']>;
  statusOptions: string[];
  labelOptions: string[];
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
  onReplace,
  onRemove,
}: {
  filter: TriggerFilter;
  offeredFields: Array<TriggerFilter['field']>;
  statusOptions: string[];
  labelOptions: string[];
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
  onChange,
}: {
  value: string;
  options: string[];
  emptyHint: string;
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
  if (value !== '' && !options.includes(value)) {
    items.unshift({ value, label: `${value} (not found)` });
  }
  return (
    <Select
      placeholder="— select —"
      value={value}
      onValueChange={onChange}
      options={items}
    />
  );
}

function BoardPickerHint({
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

function Hint({
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

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
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

function TypeButton({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-[var(--radius)] border p-2 text-left transition-colors',
        active
          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-text)]'
          : 'border-[var(--color-divider)] bg-[var(--color-bg)] hover:border-[var(--color-text-muted)]',
      )}
    >
      <div className="font-sans text-[12px] font-medium">{label}</div>
      <div className="mt-0.5 font-mono text-[10.5px] text-[var(--color-text-muted)]">{hint}</div>
    </button>
  );
}
