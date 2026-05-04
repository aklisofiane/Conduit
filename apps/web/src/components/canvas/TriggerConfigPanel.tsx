import { useEffect, useState } from 'react';
import type { BoardRef, TriggerConfig, TriggerFilter } from '@conduit/shared';
import {
  useConnections,
  useListProjectBoards,
  type BoardSummary,
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

  const [projectBoards, setProjectBoards] = useState<BoardSummary[] | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const listBoards = useListProjectBoards(workflowId);

  // Auto-load project list whenever the user has filled enough of the
  // connection + owner inputs to make a meaningful query. Debounced so
  // typing "acme" doesn't fire four GraphQL calls.
  useEffect(() => {
    setBoardError(null);
    if (
      trigger.mode.kind !== 'polling' &&
      !(trigger.mode.kind === 'webhook' && trigger.mode.event === 'board.column.changed')
    ) {
      setProjectBoards(null);
      return;
    }
    const connectionId = trigger.connectionId;
    const owner = trigger.board?.owner?.trim();
    const ownerType = trigger.board?.ownerType ?? 'org';
    if (!connectionId || !owner) {
      setProjectBoards(null);
      return;
    }
    const handle = window.setTimeout(() => {
      listBoards
        .mutateAsync({ connectionId, ownerType, owner })
        .then((boards) => {
          setProjectBoards(boards);
          setBoardError(null);
        })
        .catch((e: unknown) => {
          setProjectBoards(null);
          setBoardError(e instanceof ApiError ? e.message : String(e));
        });
    }, 400);
    return () => window.clearTimeout(handle);
    // listBoards is stable per-render of the hook; intentionally omitted
    // to avoid the mutation identity flapping the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    trigger.connectionId,
    trigger.board?.owner,
    trigger.board?.ownerType,
    trigger.mode.kind,
    trigger.mode.kind === 'webhook' ? trigger.mode.event : null,
  ]);

  const selectedBoard =
    projectBoards?.find((b) => b.number === trigger.board?.number) ?? null;

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
                {!trigger.connectionId ? (
                  <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
                    Pick a connection to load projects.
                  </div>
                ) : !trigger.board?.owner ? (
                  <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
                    Type the {trigger.board?.ownerType ?? 'org'} login to load its projects.
                  </div>
                ) : listBoards.isPending ? (
                  <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
                    Loading projects…
                  </div>
                ) : boardError ? (
                  <div className="font-mono text-[11px] text-[var(--color-danger,#d54c4c)]">
                    {boardError}
                  </div>
                ) : projectBoards && projectBoards.length === 0 ? (
                  <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
                    No Projects v2 boards found under {trigger.board.owner}.
                  </div>
                ) : projectBoards ? (
                  <div className="space-y-1.5">
                    <select
                      className="field-input"
                      value={trigger.board?.number ?? ''}
                      onChange={(e) =>
                        setBoard({ number: Number(e.target.value) || 1 })
                      }
                    >
                      <option value="">— select a project —</option>
                      {projectBoards.map((b) => (
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
                ) : null}
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
  boardFields?: BoardSummary['fields'];
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

  // Normalize matched rows: when a filter row matches a verified board
  // field, the UI hides the op selector and shows a strict dropdown — so
  // the persisted row has to be `op: 'eq'` with a single string value to
  // avoid lying about the saved semantics.
  useEffect(() => {
    if (!boardFields) return;
    let dirty = false;
    const next = filters.map((f) => {
      const match = boardFields.find(
        (bf) => bf.name.toLowerCase() === f.field.toLowerCase(),
      );
      if (!match) return f;
      if (f.op === 'eq' && !Array.isArray(f.value)) return f;
      dirty = true;
      return {
        ...f,
        op: 'eq' as const,
        value: Array.isArray(f.value) ? (f.value[0] ?? '') : f.value,
      };
    });
    if (dirty) onChange(next as TriggerFilter[]);
  }, [filters, boardFields, onChange]);

  return (
    <div className="space-y-2">
      {filters.length === 0 && (
        <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
          No filters — every matching event fires the workflow.
        </div>
      )}
      {filters.map((f, i) => {
        const match = findBoardField(f.field);
        if (match) {
          // Verified board field → strict dropdown, no op selector. The
          // useEffect above keeps op normalized to `eq`; until that fires
          // we still display the first array entry so the dropdown isn't
          // blank for one paint.
          const currentValue = Array.isArray(f.value) ? (f.value[0] ?? '') : f.value;
          return (
            <div
              key={i}
              className="grid grid-cols-[1fr_1fr_28px] gap-1.5 rounded-[var(--radius)] border border-[var(--color-divider)] bg-[var(--color-pill-bg)] p-1.5"
            >
              <input
                className="field-input"
                placeholder="field"
                value={f.field}
                onChange={(e) => setAt(i, { field: e.target.value })}
              />
              <select
                className="field-input"
                value={currentValue}
                onChange={(e) => setAt(i, { value: e.target.value })}
              >
                <option value="">— select —</option>
                {match.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              <button
                className="btn"
                onClick={() => removeAt(i)}
                aria-label="Remove filter"
                title="Remove filter"
              >
                ×
              </button>
            </div>
          );
        }

        return (
          <div
            key={i}
            className="grid grid-cols-[1fr_78px_1fr_28px] gap-1.5 rounded-[var(--radius)] border border-[var(--color-divider)] bg-[var(--color-pill-bg)] p-1.5"
          >
            <input
              className="field-input"
              placeholder="field"
              value={f.field}
              onChange={(e) => setAt(i, { field: e.target.value })}
            />
            <select
              className="field-input"
              value={f.op}
              onChange={(e) => setAt(i, { op: e.target.value as TriggerFilter['op'] })}
            >
              <option value="eq">eq</option>
              <option value="neq">neq</option>
              <option value="in">in</option>
              <option value="contains">contains</option>
            </select>
            <input
              className="field-input"
              placeholder={f.op === 'in' ? 'a, b, c' : 'value'}
              value={Array.isArray(f.value) ? f.value.join(', ') : f.value}
              onChange={(e) => {
                const raw = e.target.value;
                const next =
                  f.op === 'in'
                    ? raw
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean)
                    : raw;
                setAt(i, { value: next });
              }}
            />
            <button
              className="btn"
              onClick={() => removeAt(i)}
              aria-label="Remove filter"
              title="Remove filter"
            >
              ×
            </button>
          </div>
        );
      })}
      <button className="btn w-full" onClick={add}>
        + Add filter
      </button>
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
