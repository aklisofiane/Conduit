import { useEffect, useState } from 'react';
import type { BoardRef, TriggerConfig, TriggerFilter } from '@conduit/shared';
import type { ProjectBoardSummary } from '@conduit/shared/platform';
import { useConnections, useListProjectBoards } from '../../api/hooks.js';
import { ApiError } from '../../api/client.js';
import { cn } from '../../lib/cn.js';
import { Icon } from './Icon.js';

type BoardField = ProjectBoardSummary['fields'][number];

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
    <aside className="flex w-[320px] shrink-0 flex-col border-l border-[var(--color-divider)] bg-[var(--color-bg-panel)]">
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
              boardFields={selectedBoard?.fields}
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
    </aside>
  );
}

function FilterEditor({
  filters,
  boardFields,
  onChange,
}: {
  filters: TriggerFilter[];
  boardFields?: BoardField[];
  onChange: (filters: TriggerFilter[]) => void;
}) {
  const setAt = (i: number, patch: Partial<TriggerFilter>) => {
    const next = filters.map((f, idx) => (idx === i ? { ...f, ...patch } : f));
    onChange(next as TriggerFilter[]);
  };
  const removeAt = (i: number) => onChange(filters.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([...filters, { field: 'status', op: 'eq', value: '' }]);

  const findBoardField = (name: string) =>
    boardFields?.find((bf) => bf.name.toLowerCase() === name.toLowerCase());

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
          match={findBoardField(f.field)}
          onPatch={(patch) => setAt(i, patch)}
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
  match,
  onPatch,
  onRemove,
}: {
  filter: TriggerFilter;
  match: BoardField | undefined;
  onPatch: (patch: Partial<TriggerFilter>) => void;
  onRemove: () => void;
}) {
  // Verified board field → strict dropdown, no op selector. Old rows may
  // still carry `op: 'in'` with a string array; show the first element and
  // rewrite to `op: 'eq'` on the next user pick so we don't lie about the
  // saved semantics.
  const currentValue = Array.isArray(filter.value) ? (filter.value[0] ?? '') : filter.value;
  return (
    <div
      className={cn(
        'grid gap-1.5 rounded-[var(--radius)] border border-[var(--color-divider)] bg-[var(--color-pill-bg)] p-1.5',
        match ? 'grid-cols-[1fr_1fr_28px]' : 'grid-cols-[1fr_78px_1fr_28px]',
      )}
    >
      <input
        className="field-input"
        placeholder="field"
        value={filter.field}
        onChange={(e) => onPatch({ field: e.target.value })}
      />
      {match ? (
        <select
          className="field-input"
          value={currentValue}
          onChange={(e) => onPatch({ op: 'eq', value: e.target.value })}
        >
          <option value="">— select —</option>
          {match.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : (
        <>
          <select
            className="field-input"
            value={filter.op}
            onChange={(e) => onPatch({ op: e.target.value as TriggerFilter['op'] })}
          >
            <option value="eq">eq</option>
            <option value="neq">neq</option>
            <option value="in">in</option>
            <option value="contains">contains</option>
          </select>
          <input
            className="field-input"
            placeholder={filter.op === 'in' ? 'a, b, c' : 'value'}
            value={Array.isArray(filter.value) ? filter.value.join(', ') : filter.value}
            onChange={(e) => {
              const raw = e.target.value;
              const next =
                filter.op === 'in'
                  ? raw
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
                  : raw;
              onPatch({ value: next });
            }}
          />
        </>
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
