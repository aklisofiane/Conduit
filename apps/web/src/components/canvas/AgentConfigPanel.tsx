import {
  PROVIDER_EFFORT_LEVELS,
  PROVIDER_MODELS,
  type AgentConfig,
  type AgentIssueWriteback,
  type EffortLevel,
  type TriggerConfig,
} from '@conduit/shared';
import {
  useAgentPresets,
  useConnections,
  useListLabels,
  useListProjectBoards,
  useSkills,
} from '../../api/hooks.js';
import type { AgentPreset } from '../../api/types.js';
import { cn } from '../../lib/cn.js';
import { providerStyle } from '../../styles/theme.js';
import { Select, type SelectItem } from '../common/Select.js';
import { Button } from '../ui/button.js';
import { Maximize2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { McpServerPicker } from './McpServerPicker.js';
import { PromptEditorDialog, promptCounts } from './PromptEditorDialog.js';
import { SkillPicker } from './SkillPicker.js';

const CUSTOM_PRESET_ID = '__custom__';
/** Sentinel for "no explicit effort" — the Select can't carry `undefined`. */
const EFFORT_DEFAULT = '__default__';

interface AgentConfigPanelProps {
  agent: AgentConfig;
  workflowId: string;
  /**
   * GitHub trigger that sources the writeback allowlist (repo for labels,
   * board for statuses). Any GitHub trigger qualifies — including `cron`,
   * which writes back to issues the agent creates rather than a triggering
   * issue. Undefined when the workflow has no GitHub trigger.
   */
  writebackTrigger?: TriggerConfig;
  onChange: (patch: Partial<AgentConfig>) => void;
  onSave: () => void;
  onDiscard: () => void;
  onClose: () => void;
  saving: boolean;
  dirty: boolean;
}

export function AgentConfigPanel({
  agent,
  workflowId,
  writebackTrigger,
  onChange,
  onSave,
  onDiscard,
  onClose,
  saving,
  dirty,
}: AgentConfigPanelProps) {
  const { data: skills = [] } = useSkills();
  const providerSkills = useMemo(
    () => skills.filter((s) => s.provider === 'both' || s.provider === agent.provider),
    [skills, agent.provider],
  );
  const { data: presets = [] } = useAgentPresets();
  const presetsByCategory = useMemo(() => groupPresetsByCategory(presets), [presets]);
  // Picker reflects the current agent by content match; falls back to
  // "Custom" once the user edits any of the three fields.
  const matchedPresetId = useMemo(
    () =>
      presets.find(
        (p) =>
          p.instructions === agent.instructions &&
          p.model === agent.model &&
          p.provider === agent.provider,
      )?.id ?? '',
    [presets, agent.instructions, agent.model, agent.provider],
  );
  const ps = providerStyle(agent.provider);
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);

  const applyPreset = (presetId: string) => {
    if (!presetId || presetId === matchedPresetId) return;
    if (presetId === CUSTOM_PRESET_ID) {
      if (!agent.instructions.trim()) return;
      if (!window.confirm("Clear this agent's instructions and start fresh?")) return;
      onChange({ instructions: '' });
      return;
    }
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;
    if (
      agent.instructions.trim() &&
      agent.instructions !== preset.instructions &&
      !window.confirm(
        `Replace this agent's instructions with the "${preset.name}" preset?`,
      )
    ) {
      return;
    }
    onChange({
      instructions: preset.instructions,
      model: preset.model,
      provider: preset.provider,
    });
  };

  return (
    <>
      <div className="flex items-start justify-between border-b border-[var(--color-divider)] px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--color-text-muted)]">
            <span
              className="h-[6px] w-[6px] rounded-full"
              style={{ background: ps.mark }}
            />
            Agent · {ps.label}
          </div>
          <h3 className="mt-2 truncate font-sans text-[15px] font-semibold text-[var(--color-text)]">
            <span>{agent.name}</span>
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

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-5">
          <Field label="Name">
            <input
              className="field-input"
              value={agent.name}
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </Field>

          {presets.length > 0 && (
            <Field label="Preset" hint="prefill instructions, model, provider">
              <Select
                ariaLabel="Preset"
                value={matchedPresetId || CUSTOM_PRESET_ID}
                onValueChange={applyPreset}
                options={[
                  ...presetsByCategory.map(
                    ([category, list]): SelectItem => ({
                      label: category,
                      options: list.map((p) => ({ value: p.id, label: p.name })),
                    }),
                  ),
                  { value: CUSTOM_PRESET_ID, label: 'Custom — write your own' },
                ]}
              />
            </Field>
          )}

          <Field label="Provider & model">
            <div className="grid grid-cols-2 gap-2">
              <Select
                ariaLabel="Provider"
                value={agent.provider}
                onValueChange={(v) => {
                  const provider = v as AgentConfig['provider'];
                  const models = PROVIDER_MODELS[provider];
                  const model = models.includes(agent.model) ? agent.model : models[0];
                  // Clamp effort the same way as model — drop it if the new
                  // provider doesn't accept the current level.
                  const effort =
                    agent.effort && PROVIDER_EFFORT_LEVELS[provider].includes(agent.effort)
                      ? agent.effort
                      : undefined;
                  onChange({ provider, model, effort });
                }}
                options={[
                  { value: 'claude', label: 'Claude' },
                  { value: 'codex', label: 'Codex' },
                ]}
              />
              <Select
                ariaLabel="Model"
                value={agent.model}
                onValueChange={(v) => onChange({ model: v })}
                options={PROVIDER_MODELS[agent.provider].map((m) => ({
                  value: m,
                  label: m,
                }))}
              />
            </div>
          </Field>

          <Field label="Reasoning effort" hint="omit to use the model default">
            <Select
              ariaLabel="Reasoning effort"
              value={agent.effort ?? EFFORT_DEFAULT}
              onValueChange={(v) =>
                onChange({ effort: v === EFFORT_DEFAULT ? undefined : (v as EffortLevel) })
              }
              options={[
                { value: EFFORT_DEFAULT, label: 'Default' },
                ...PROVIDER_EFFORT_LEVELS[agent.provider].map((e) => ({
                  value: e,
                  label: e,
                })),
              ]}
            />
          </Field>

          <div>
            <div className="field-label">
              Instructions
              <span className="hint">system prompt</span>
              <button
                type="button"
                onClick={() => setPromptEditorOpen(true)}
                className="ml-auto inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 font-mono text-[10px] tracking-normal text-[var(--color-accent)] normal-case transition-colors hover:bg-[var(--color-pill-bg)]"
              >
                <Maximize2 size={11} strokeWidth={1.75} />
                Expand
              </button>
            </div>
            <textarea
              className="field-input"
              rows={8}
              value={agent.instructions}
              onChange={(e) => onChange({ instructions: e.target.value })}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  setPromptEditorOpen(true);
                }
              }}
              placeholder="You are an agent that…"
            />
            <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-[var(--color-text-muted)]">
              <span>
                {promptCounts(agent.instructions).chars} chars ·{' '}
                {promptCounts(agent.instructions).lines} lines
              </span>
              <span className="kbd">⌘↵</span>
            </div>
          </div>

          <Field label="Web search">
            <label className="flex cursor-pointer items-center gap-2 font-mono text-[12px]">
              <input
                type="checkbox"
                checked={agent.webSearch}
                onChange={(e) => onChange({ webSearch: e.target.checked })}
              />
              <span>Enable</span>
            </label>
          </Field>

          <Field
            label="Issue / PR writeback"
            hint="set status / state / apply labels at end of run"
          >
            <IssueWritebackControl
              trigger={writebackTrigger}
              value={agent.issueWriteback}
              onChange={(next) => onChange({ issueWriteback: next })}
            />
          </Field>

          <Field label="MCP servers" hint="tools from external services">
            <McpServerPicker
              agent={agent}
              workflowId={workflowId}
              onChange={onChange}
            />
          </Field>

          <Field label="Skills" hint="from .claude/skills/ + plugins">
            {providerSkills.length === 0 ? (
              <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
                No skills discovered. Add SKILL.md files under .claude/skills/ on the worker or in a connected repo, or install a Claude Code plugin.
              </div>
            ) : (
              <SkillPicker
                skills={providerSkills}
                selected={agent.skills}
                onChange={(skills) => onChange({ skills })}
              />
            )}
          </Field>
        </div>
      </div>

      <div className="flex gap-2 border-t border-[var(--color-divider)] bg-[var(--color-bg-panel)] px-5 py-4">
        <Button className="flex-1" onClick={onDiscard} disabled={!dirty}>
          Discard
        </Button>
        <Button variant="primary" className="flex-1" onClick={onSave} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>

      <PromptEditorDialog
        open={promptEditorOpen}
        onOpenChange={setPromptEditorOpen}
        value={agent.instructions}
        name={agent.name}
        contextLabel={`${ps.label} · ${agent.model}`}
        onCommit={(instructions) => onChange({ instructions })}
      />
    </>
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

function IssueWritebackControl({
  trigger,
  value,
  onChange,
}: {
  trigger: TriggerConfig | undefined;
  value: AgentIssueWriteback | undefined;
  onChange: (next: AgentIssueWriteback | undefined) => void;
}) {
  const enabled = value !== undefined;
  const isPr = trigger?.type === 'pull_requests';
  const connectionId = trigger?.connectionId ?? '';
  const boardConnectionId = trigger?.boardConnectionId ?? '';
  const { data: connections = [] } = useConnections();
  const boardConnection = connections.find((c) => c.id === boardConnectionId);
  const boardScope =
    boardConnection?.scope.kind === 'github_projects_v2'
      ? boardConnection.scope
      : undefined;

  const boardsQuery = useListProjectBoards({
    connectionId: boardConnectionId,
    ownerType: boardScope?.ownerType ?? 'org',
    owner: boardScope?.owner ?? '',
    enabled: enabled && !!trigger && !!boardConnectionId && !!boardScope,
  });
  const matchedBoard =
    boardsQuery.data?.find((b) => b.number === boardScope?.number) ?? null;
  const statusOptions =
    matchedBoard?.fields.find((f) => f.name.toLowerCase() === 'status')?.options ?? [];

  const labelsQuery = useListLabels({
    connectionId,
    enabled: enabled && !!trigger,
  });
  const labelOptions = labelsQuery.data ?? [];

  const toggle = (next: boolean) => {
    onChange(next ? { allowedStatuses: [], allowedLabels: [], allowedPrStates: [] } : undefined);
  };

  const toggleStatus = (status: string) => {
    if (!value) return;
    const set = new Set(value.allowedStatuses);
    if (set.has(status)) set.delete(status);
    else set.add(status);
    onChange({ ...value, allowedStatuses: [...set] });
  };

  const toggleLabel = (label: string) => {
    if (!value) return;
    const set = new Set(value.allowedLabels);
    if (set.has(label)) set.delete(label);
    else set.add(label);
    onChange({ ...value, allowedLabels: [...set] });
  };

  const togglePrState = (state: string) => {
    if (!value) return;
    type PrState = AgentIssueWriteback['allowedPrStates'][number];
    const set = new Set(value.allowedPrStates);
    if (set.has(state as PrState)) set.delete(state as PrState);
    else set.add(state as PrState);
    onChange({ ...value, allowedPrStates: [...set] });
  };

  if (!trigger) {
    return (
      <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
        Add a trigger to enable issue writeback.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="flex cursor-pointer items-center gap-2 font-mono text-[12px]">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => toggle(e.target.checked)}
        />
        <span>Allow updating issue/PR status &amp; labels</span>
      </label>

      {enabled && (
        <div className="space-y-3 rounded-[var(--radius)] border border-[var(--color-divider)] bg-[var(--color-bg)] p-3">
          {isPr ? (
            // PR triggers carry no project board — offer the repo-native PR
            // state axes instead of a board Status column. Two orthogonal
            // sub-axes: open/closed (active) and draft/ready (ready for review).
            <PillSection label="Allowed PR states" empty={null}>
              <PillToggleGroup
                options={['open', 'closed', 'draft', 'ready']}
                selected={value?.allowedPrStates ?? []}
                onToggle={togglePrState}
              />
            </PillSection>
          ) : (
            <PillSection
              label="Allowed statuses"
              empty={
                !boardScope
                  ? "Trigger has no project board — set one to pick statuses."
                  : boardsQuery.isLoading
                    ? 'Loading…'
                    : statusOptions.length === 0
                      ? "No Status field options found on the trigger's project."
                      : null
              }
            >
              <PillToggleGroup
                options={statusOptions}
                selected={value?.allowedStatuses ?? []}
                onToggle={toggleStatus}
              />
            </PillSection>
          )}

          <PillSection
            label="Allowed labels"
            empty={
              labelsQuery.isLoading
                ? 'Loading…'
                : labelOptions.length === 0
                  ? "No labels found on the trigger's repo."
                  : null
            }
          >
            <PillToggleGroup
              options={labelOptions.map((l) => l.name)}
              selected={value?.allowedLabels ?? []}
              onToggle={toggleLabel}
            />
          </PillSection>

          {value &&
            value.allowedStatuses.length === 0 &&
            value.allowedLabels.length === 0 &&
            // Null-safe: workflows saved before the PR-state axis existed have
            // no `allowedPrStates` until the definition is re-parsed on save.
            (value.allowedPrStates?.length ?? 0) === 0 && (
              <div className="font-mono text-[10.5px] text-[var(--color-text-muted)]">
                Pick at least one {isPr ? 'state' : 'status'} or label — without
                selections, the writeback turn is skipped at run time.
              </div>
            )}
        </div>
      )}
    </div>
  );
}

function PillSection({
  label,
  empty,
  children,
}: {
  label: string;
  /** Non-null shows a muted hint instead of children — covers loading and empty states. */
  empty: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-[var(--color-text-muted)]">
        {label}
      </div>
      {empty !== null ? (
        <div className="font-mono text-[11px] text-[var(--color-text-muted)]">{empty}</div>
      ) : (
        children
      )}
    </div>
  );
}

function PillToggleGroup({
  options,
  selected,
  onToggle,
}: {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onToggle(opt)}
          className={cn(
            'rounded-[var(--radius-sm)] border px-2 py-[3px] font-mono text-[11px] transition-colors',
            selected.includes(opt)
              ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-text)]'
              : 'border-[var(--color-divider)] text-[var(--color-text-muted)] hover:border-[var(--color-text-muted)]',
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function groupPresetsByCategory(presets: AgentPreset[]): [string, AgentPreset[]][] {
  const groups = presets.reduce((acc, p) => {
    (acc.get(p.category) ?? acc.set(p.category, []).get(p.category)!).push(p);
    return acc;
  }, new Map<string, AgentPreset[]>());
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}
