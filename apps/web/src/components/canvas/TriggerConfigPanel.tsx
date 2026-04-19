import type { BoardRef, TriggerConfig, TriggerFilter } from '@conduit/shared';
import { useConnections } from '../../api/hooks.js';
import { cn } from '../../lib/cn.js';

interface TriggerConfigPanelProps {
  trigger: TriggerConfig;
  workflowId: string;
  onChange: (patch: Partial<TriggerConfig>) => void;
  onSave: () => void;
  onDiscard: () => void;
  saving: boolean;
  dirty: boolean;
}

/**
 * Sibling of `AgentConfigPanel` — edits the single `TriggerConfig` on the
 * workflow. One form for both trigger modes, gated by the mode toggle.
 * Validation lives in the shared Zod schema; this panel just keeps the
 * shape coherent while the user clicks around (swapping mode resets the
 * mode-specific fields).
 */
export function TriggerConfigPanel({
  trigger,
  workflowId,
  onChange,
  onSave,
  onDiscard,
  saving,
  dirty,
}: TriggerConfigPanelProps) {
  const { data: connections = [] } = useConnections(workflowId);
  const platformConnections = connections.filter(
    (c) => c.credential.platform.toLowerCase() === trigger.platform,
  );

  const setMode = (kind: 'webhook' | 'polling') => {
    if (kind === trigger.mode.kind) return;
    if (kind === 'webhook') {
      onChange({
        mode: {
          kind: 'webhook',
          event: trigger.platform === 'github' ? 'issues.opened' : '',
          active: trigger.mode.active,
        },
      });
    } else {
      onChange({
        mode: { kind: 'polling', intervalSec: 60, active: trigger.mode.active },
      });
    }
  };

  const setBoard = (patch: Partial<BoardRef>) => {
    const current: BoardRef =
      trigger.board ?? { ownerType: 'org', owner: '', number: 1 };
    onChange({ board: { ...current, ...patch } });
  };

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-[var(--color-line)] bg-[var(--color-bg-1)]">
      <div className="border-b border-[var(--color-line)] px-5 py-4">
        <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-3)]">
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              trigger.mode.active ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-4)]',
            )}
            style={
              trigger.mode.active ? { boxShadow: '0 0 6px var(--color-success)' } : undefined
            }
          />
          Trigger · {trigger.platform}
        </div>
        <h3 className="mt-2 font-mono text-[15px] font-semibold">
          <span>{trigger.mode.kind}</span>
          <span className="text-[var(--color-text-4)]"> · config</span>
        </h3>
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
              <div className="font-mono text-[11px] text-[var(--color-text-4)]">
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
              <div className="grid grid-cols-[110px_1fr_90px] gap-2">
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
                <input
                  className="field-input"
                  type="number"
                  min={1}
                  placeholder="#"
                  value={trigger.board?.number ?? ''}
                  onChange={(e) =>
                    setBoard({ number: Math.max(1, Number(e.target.value) || 1) })
                  }
                />
              </div>
            </Field>
          )}

          <Field label="Active" hint="pause the trigger without deleting it">
            <label className="flex cursor-pointer items-center gap-2 font-mono text-[12px]">
              <input
                type="checkbox"
                checked={trigger.mode.active}
                onChange={(e) =>
                  onChange({
                    mode: { ...trigger.mode, active: e.target.checked } as TriggerConfig['mode'],
                  })
                }
              />
              <span>
                {trigger.mode.active ? 'active — receiving events' : 'paused'}
              </span>
            </label>
          </Field>

          <Field label="Filters" hint="AND-combined — an event must pass all">
            <FilterEditor
              filters={trigger.filters}
              onChange={(filters) => onChange({ filters })}
            />
          </Field>
        </div>
      </div>

      <div className="flex gap-2 border-t border-[var(--color-line)] bg-[var(--color-bg-1)] px-5 py-4">
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
  onChange,
}: {
  filters: TriggerFilter[];
  onChange: (filters: TriggerFilter[]) => void;
}) {
  const setAt = (i: number, patch: Partial<TriggerFilter>) => {
    const next = filters.map((f, idx) => (idx === i ? { ...f, ...patch } : f));
    onChange(next as TriggerFilter[]);
  };
  const removeAt = (i: number) => onChange(filters.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([...filters, { field: 'status', op: 'eq', value: '' }]);

  return (
    <div className="space-y-2">
      {filters.length === 0 && (
        <div className="font-mono text-[11px] text-[var(--color-text-4)]">
          No filters — every matching event fires the workflow.
        </div>
      )}
      {filters.map((f, i) => (
        <div
          key={i}
          className="grid grid-cols-[1fr_78px_1fr_28px] gap-1.5 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] p-1.5"
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
      ))}
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
        'rounded-md border p-2 text-left transition-colors',
        active
          ? 'border-[var(--color-line-2)] bg-[var(--color-bg-2)]'
          : 'border-[var(--color-line)] bg-[var(--color-bg-1)] hover:border-[var(--color-line-2)]',
      )}
    >
      <div className="font-mono text-[12px] font-medium">{label}</div>
      <div className="mt-0.5 font-mono text-[10.5px] text-[var(--color-text-3)]">{hint}</div>
    </button>
  );
}

const WEBHOOK_EVENTS: Array<{ value: string; label: string }> = [
  { value: 'issues.opened', label: 'issues.opened — new issue created' },
  { value: 'pull_request.opened', label: 'pull_request.opened — new PR' },
  { value: 'issue_comment.created', label: 'issue_comment.created — PR comment' },
  { value: 'board.column.changed', label: 'board.column.changed — Projects v2' },
];
