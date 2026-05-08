import { useEffect, useState } from 'react';
import type { BoardRef, TriggerConfig, TriggerFilter } from '@conduit/shared';
import type { ProjectBoardSummary } from '@conduit/shared/platform';
import {
  useConnections,
  useListLabels,
  useListProjectBoards,
} from '../../api/hooks.js';
import { ApiError } from '../../api/client.js';
import { cn } from '../../lib/cn.js';
import { Icon } from './Icon.js';

interface TriggerConfigPanelProps {
  trigger: TriggerConfig;
  workflowId: string;
  isActive: boolean;
  onChange: (patch: Partial<TriggerConfig>) => void;
  onActiveChange: (next: boolean) => void;
  onSave: () => void;
  onDiscard: () => void;
  onClose: () => void;
  saving: boolean;
  dirty: boolean;
}

export function TriggerConfigPanel({
  trigger,
  workflowId,
  isActive,
  onChange,
  onActiveChange,
  onSave,
  onDiscard,
  onClose,
  saving,
  dirty,
}: TriggerConfigPanelProps) {
  const { data: connections = [] } = useConnections(workflowId);
  const platformConnections = connections.filter(
    (c) => c.credential.platform.toLowerCase() === trigger.platform,
  );

  const owner = trigger.board?.owner?.trim() ?? '';
  const ownerType = trigger.board?.ownerType ?? 'org';
  const needsBoard =
    trigger.mode.kind === 'polling' ||
    (trigger.mode.kind === 'webhook' &&
      trigger.mode.event === 'board.column.changed');

  // Coalesce keystrokes so typing "acme" doesn't re-key the query four times.
  const [debouncedOwner, setDebouncedOwner] = useState(owner);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedOwner(owner), 400);
    return () => window.clearTimeout(handle);
  }, [owner]);

  const boardsQuery = useListProjectBoards({
    workflowId,
    connectionId: trigger.connectionId,
    ownerType,
    owner: debouncedOwner,
    enabled: needsBoard,
  });

  const selectedBoard =
    boardsQuery.data?.find((b) => b.number === trigger.board?.number) ?? null;

  const labelsQuery = useListLabels({
    workflowId,
    connectionId: trigger.connectionId,
    enabled: !!trigger.connectionId,
  });

  const statusOptions =
    selectedBoard?.fields.find((f) => f.name === 'Status')?.options ?? [];
  const labelOptions = labelsQuery.data?.map((l) => l.name) ?? [];

  const setMode = (kind: 'webhook' | 'polling') => {
    if (kind === trigger.mode.kind) return;
    if (kind === 'webhook') {
      onChange({
        mode: {
          kind: 'webhook',
          event: trigger.platform === 'github' ? 'issues.opened' : '',
        },
      });
    } else {
      onChange({
        mode: { kind: 'polling', intervalSec: 60 },
      });
    }
  };

  const setBoard = (patch: Partial<BoardRef>) => {
    const current: BoardRef =
      trigger.board ?? { ownerType: 'org', owner: '', number: 1 };
    onChange({ board: { ...current, ...patch } });
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
            <span>{trigger.mode.kind}</span>
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
        <div className="space-y-5">
          <Field label="Platform">
            <select
              className="field-input"
              value={trigger.platform}
              onChange={(e) =>
                onChange({ platform: e.target.value as TriggerConfig['platform'] })
              }
            >
              <option value="github">GitHub</option>
              <option value="gitlab" disabled>
                GitLab (coming soon)
              </option>
              <option value="jira" disabled>
                Jira (coming soon)
              </option>
            </select>
          </Field>

          <Field label="Connection" hint="credential used by this trigger">
            {platformConnections.length === 0 ? (
              <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
                No {trigger.platform} connections yet. Add one on the Connections page.
              </div>
            ) : (
              <select
                className="field-input"
                value={trigger.connectionId}
                onChange={(e) => onChange({ connectionId: e.target.value })}
              >
                <option value="">— select a connection —</option>
                {platformConnections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.alias}
                    {c.owner && c.repo ? ` · ${c.owner}/${c.repo}` : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Mode">
            <div className="grid grid-cols-2 gap-2">
              <ModeButton
                active={trigger.mode.kind === 'webhook'}
                onClick={() => setMode('webhook')}
                label="Webhook"
                hint="platform pushes events"
              />
              <ModeButton
                active={trigger.mode.kind === 'polling'}
                onClick={() => setMode('polling')}
                label="Polling"
                hint="Conduit pulls on interval"
              />
            </div>
          </Field>

          {trigger.mode.kind === 'webhook' && (
            <Field label="Event" hint="which webhook fires this trigger">
              <select
                className="field-input"
                value={trigger.mode.event}
                onChange={(e) =>
                  onChange({
                    mode: { ...trigger.mode, event: e.target.value, kind: 'webhook' },
                  })
                }
              >
                {WEBHOOK_EVENTS.map((ev) => (
                  <option key={ev.value} value={ev.value}>
                    {ev.label}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {trigger.mode.kind === 'polling' && (
            <Field label="Interval" hint="seconds between poll cycles">
              <input
                className="field-input"
                type="number"
                min={10}
                step={10}
                value={trigger.mode.intervalSec}
                onChange={(e) =>
                  onChange({
                    mode: {
                      ...trigger.mode,
                      kind: 'polling',
                      intervalSec: Math.max(10, Number(e.target.value) || 60),
                    },
                  })
                }
              />
            </Field>
          )}

          {(trigger.mode.kind === 'polling' ||
            (trigger.mode.kind === 'webhook' &&
              trigger.mode.event === 'board.column.changed')) && (
            <Field
              label="Project board"
              hint="GitHub Projects v2 — Conduit watches this board"
            >
              <div className="grid grid-cols-[110px_1fr] gap-2">
                <select
                  className="field-input"
                  value={trigger.board?.ownerType ?? 'org'}
                  onChange={(e) =>
                    setBoard({ ownerType: e.target.value as BoardRef['ownerType'] })
                  }
                >
                  <option value="org">Org</option>
                  <option value="user">User</option>
                </select>
                <input
                  className="field-input"
                  placeholder="owner (e.g. acme)"
                  value={trigger.board?.owner ?? ''}
                  onChange={(e) => setBoard({ owner: e.target.value })}
                />
              </div>
              <div className="mt-2">
                <BoardPicker
                  hasConnection={!!trigger.connectionId}
                  owner={owner}
                  ownerType={ownerType}
                  query={boardsQuery}
                  selectedNumber={trigger.board?.number}
                  selectedBoard={selectedBoard}
                  onPick={(number) => setBoard({ number })}
                />
              </div>
            </Field>
          )}

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
              statusOptions={statusOptions}
              labelOptions={labelOptions}
              onChange={(filters) => onChange({ filters })}
            />
          </Field>
        </div>
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

function FilterEditor({
  filters,
  statusOptions,
  labelOptions,
  onChange,
}: {
  filters: TriggerFilter[];
  statusOptions: string[];
  labelOptions: string[];
  onChange: (filters: TriggerFilter[]) => void;
}) {
  const replaceAt = (i: number, next: TriggerFilter) =>
    onChange(filters.map((f, idx) => (idx === i ? next : f)));
  const removeAt = (i: number) => onChange(filters.filter((_, idx) => idx !== i));
  const add = () => onChange([...filters, { field: 'status', value: '' }]);

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
  statusOptions,
  labelOptions,
  onReplace,
  onRemove,
}: {
  filter: TriggerFilter;
  statusOptions: string[];
  labelOptions: string[];
  onReplace: (next: TriggerFilter) => void;
  onRemove: () => void;
}) {
  const setKind = (next: TriggerFilter['field']) => {
    if (next === filter.field) return;
    onReplace({ field: next, value: '' });
  };

  return (
    <div className="grid grid-cols-[100px_1fr_28px] gap-1.5 rounded-[var(--radius)] border border-[var(--color-divider)] bg-[var(--color-pill-bg)] p-1.5">
      <select
        className="field-input"
        value={filter.field}
        onChange={(e) => setKind(e.target.value as TriggerFilter['field'])}
      >
        <option value="status">Status</option>
        <option value="label">Label</option>
      </select>
      {filter.field === 'status' ? (
        <OptionsValueInput
          value={filter.value}
          options={statusOptions}
          emptyHint="(pick a board to load Status options)"
          onChange={(value) => onReplace({ field: 'status', value })}
        />
      ) : (
        <OptionsValueInput
          value={filter.value}
          options={labelOptions}
          emptyHint="(no labels — pick a connection bound to a repo)"
          onChange={(value) => onReplace({ field: 'label', value })}
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
  // No options loaded yet → fall back to free-text input so the row stays
  // usable. Saving an unmatchable value is the user's call.
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
  // Stale-cache safety: if the saved value isn't in the live options list
  // (e.g. label was renamed since save), show it as a synthetic option so
  // the user sees the truth of what's stored, not a silent reset to ''.
  const showStaleOption = value !== '' && !options.includes(value);
  return (
    <select
      className="field-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">— select —</option>
      {showStaleOption && <option value={value}>{value} (not found)</option>}
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

function BoardPicker({
  hasConnection,
  owner,
  ownerType,
  query,
  selectedNumber,
  selectedBoard,
  onPick,
}: {
  hasConnection: boolean;
  owner: string;
  ownerType: BoardRef['ownerType'];
  query: ReturnType<typeof useListProjectBoards>;
  selectedNumber: number | undefined;
  selectedBoard: ProjectBoardSummary | null;
  onPick: (number: number) => void;
}) {
  if (!hasConnection) return <Hint>Pick a connection to load projects.</Hint>;
  if (!owner) return <Hint>Type the {ownerType} login to load its projects.</Hint>;
  if (query.isFetching && !query.data) return <Hint>Loading projects…</Hint>;
  if (query.error) {
    const message = query.error instanceof ApiError ? query.error.message : String(query.error);
    return <Hint tone="danger">{message}</Hint>;
  }
  if (!query.data) return null;
  if (query.data.length === 0) {
    return <Hint>No Projects v2 boards found under {owner}.</Hint>;
  }
  return (
    <div className="space-y-1.5">
      <select
        className="field-input"
        value={selectedNumber ?? ''}
        onChange={(e) => onPick(Number(e.target.value) || 1)}
      >
        <option value="">— select a project —</option>
        {query.data.map((b) => (
          <option key={b.number} value={b.number}>
            #{b.number} · {b.title}
          </option>
        ))}
      </select>
      {selectedBoard && (
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
      )}
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

function ModeButton({
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

const WEBHOOK_EVENTS: Array<{ value: string; label: string }> = [
  { value: 'issues.opened', label: 'issues.opened — new issue created' },
  { value: 'pull_request.opened', label: 'pull_request.opened — new PR' },
  { value: 'issue_comment.created', label: 'issue_comment.created — PR comment' },
  { value: 'board.column.changed', label: 'board.column.changed — Projects v2' },
];
