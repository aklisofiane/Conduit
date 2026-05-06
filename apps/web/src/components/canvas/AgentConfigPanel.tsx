import {
  PROVIDER_MODELS,
  type AgentConfig,
  type AgentIssueWriteback,
  type TriggerConfig,
} from '@conduit/shared';
import { useAgentPresets, useListLabels, useListProjectBoards, useSkills } from '../../api/hooks.js';
import type { AgentPreset } from '../../api/types.js';
import { cn } from '../../lib/cn.js';
import { providerStyle } from '../../styles/theme.js';
import { Icon } from './Icon.js';
import { McpServerPicker } from './McpServerPicker.js';

interface AgentConfigPanelProps {
  agent: AgentConfig;
  workflowId: string;
  /**
   * The workflow's GitHub trigger, when present. Drives the issue-writeback
   * pickers (project Status options + repo labels). Undefined disables the
   * writeback field with a hint.
   */
  githubTrigger?: TriggerConfig;
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
  githubTrigger,
  onChange,
  onSave,
  onDiscard,
  onClose,
  saving,
  dirty,
}: AgentConfigPanelProps) {
  const { data: skills = [] } = useSkills();
  const providerSkills = skills.filter(
    (s) => s.provider === 'both' || s.provider === agent.provider,
  );
  const { data: presets = [] } = useAgentPresets();
  const presetsByCategory = groupPresetsByCategory(presets);
  // Picker reflects the current agent by content match; falls back to
  // "Custom" once the user edits any of the three fields.
  const matchedPresetId =
    presets.find(
      (p) =>
        p.instructions === agent.instructions &&
        p.model === agent.model &&
        p.provider === agent.provider,
    )?.id ?? '';
  const ps = providerStyle(agent.provider);
  const selectedSkillIds = new Set(agent.skills.map((s) => s.skillId));

  const applyPreset = (presetId: string) => {
    if (!presetId || presetId === matchedPresetId) return;
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
          <Icon name="close" size={14} color="currentColor" />
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
              <select
                className="field-input"
                value={matchedPresetId}
                onChange={(e) => applyPreset(e.target.value)}
              >
                <option value="">Custom — write your own</option>
                {presetsByCategory.map(([category, list]) => (
                  <optgroup key={category} label={category}>
                    {list.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {p.description}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
          )}

          <Field label="Provider & model">
            <div className="grid grid-cols-2 gap-2">
              <select
                className="field-input"
                value={agent.provider}
                onChange={(e) => {
                  const provider = e.target.value as AgentConfig['provider'];
                  const models = PROVIDER_MODELS[provider];
                  const model = models.includes(agent.model) ? agent.model : models[0];
                  onChange({ provider, model });
                }}
              >
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
              </select>
              <select
                className="field-input"
                value={agent.model}
                onChange={(e) => onChange({ model: e.target.value })}
              >
                {PROVIDER_MODELS[agent.provider].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </Field>

          <Field label="Instructions" hint="system prompt">
            <textarea
              className="field-input"
              rows={8}
              value={agent.instructions}
              onChange={(e) => onChange({ instructions: e.target.value })}
              placeholder="You are an agent that…"
            />
          </Field>

          <Field label="Workspace">
            <select
              className="field-input"
              value={agent.workspace.kind}
              onChange={(e) => {
                const kind = e.target.value as AgentConfig['workspace']['kind'];
                if (kind === 'fresh-tmpdir') {
                  onChange({ workspace: { kind: 'fresh-tmpdir' } });
                } else if (kind === 'repo-clone') {
                  onChange({ workspace: { kind: 'repo-clone', connectionId: '' } });
                } else if (kind === 'inherit') {
                  onChange({ workspace: { kind: 'inherit', fromNode: '' } });
                } else if (kind === 'ticket-branch') {
                  onChange({ workspace: { kind: 'ticket-branch', connectionId: '' } });
                }
              }}
            >
              <option value="fresh-tmpdir">fresh-tmpdir</option>
              <option value="repo-clone">repo-clone</option>
              <option value="inherit">inherit</option>
              <option value="ticket-branch">ticket-branch</option>
            </select>
          </Field>

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
            label="Issue writeback"
            hint="set status / apply labels at end of run"
          >
            <IssueWritebackControl
              workflowId={workflowId}
              trigger={githubTrigger}
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

          <Field label="Skills" hint="from .claude/skills/">
            {providerSkills.length === 0 ? (
              <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
                No skills discovered. Add SKILL.md files under .claude/skills/ on the worker or in a connected repo.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-1.5">
                {providerSkills.map((skill) => {
                  const selected = selectedSkillIds.has(skill.id);
                  return (
                    <button
                      key={skill.id}
                      onClick={() =>
                        onChange({
                          skills: selected
                            ? agent.skills.filter((s) => s.skillId !== skill.id)
                            : [...agent.skills, { skillId: skill.id, source: skill.source }],
                        })
                      }
                      className={cn(
                        'rounded-[var(--radius)] border p-2 text-left transition-colors',
                        selected
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                          : 'border-[var(--color-divider)] bg-[var(--color-bg)] hover:border-[var(--color-text-muted)]',
                      )}
                    >
                      <div className="flex items-center gap-2 font-sans text-[12px] font-medium text-[var(--color-text)]">
                        <span style={{ color: ps.mark }}>✶</span>
                        {skill.name}
                      </div>
                      {skill.description && (
                        <div className="mt-1 font-mono text-[10.5px] text-[var(--color-text-muted)]">
                          {skill.description}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
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
  workflowId,
  trigger,
  value,
  onChange,
}: {
  workflowId: string;
  trigger: TriggerConfig | undefined;
  value: AgentIssueWriteback | undefined;
  onChange: (next: AgentIssueWriteback | undefined) => void;
}) {
  const enabled = value !== undefined;
  const board = trigger?.board;
  const connectionId = trigger?.connectionId ?? '';

  const boardsQuery = useListProjectBoards({
    workflowId,
    connectionId,
    ownerType: board?.ownerType ?? 'org',
    owner: board?.owner ?? '',
    enabled: enabled && !!trigger && !!board,
  });
  const matchedBoard =
    boardsQuery.data?.find((b) => b.number === board?.number) ?? null;
  const statusOptions =
    matchedBoard?.fields.find((f) => f.name.toLowerCase() === 'status')?.options ?? [];

  const labelsQuery = useListLabels({
    workflowId,
    connectionId,
    enabled: enabled && !!trigger,
  });
  const labelOptions = labelsQuery.data ?? [];

  const toggle = (next: boolean) => {
    onChange(next ? { allowedStatuses: [], allowedLabels: [] } : undefined);
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

  if (!trigger) {
    return (
      <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
        Add a GitHub trigger to enable issue writeback.
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
        <span>Allow updating issue status / labels</span>
      </label>

      {enabled && (
        <div className="space-y-3 rounded-[var(--radius)] border border-[var(--color-divider)] bg-[var(--color-bg)] p-3">
          <div>
            <div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-[var(--color-text-muted)]">
              Allowed statuses
            </div>
            {!board ? (
              <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
                Trigger has no project board — set one to pick statuses.
              </div>
            ) : boardsQuery.isLoading ? (
              <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
                Loading…
              </div>
            ) : statusOptions.length === 0 ? (
              <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
                No Status field options found on the trigger's project.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {statusOptions.map((opt) => {
                  const selected = value?.allowedStatuses.includes(opt) ?? false;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => toggleStatus(opt)}
                      className={cn(
                        'rounded-[var(--radius-sm)] border px-2 py-[3px] font-mono text-[11px] transition-colors',
                        selected
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-text)]'
                          : 'border-[var(--color-divider)] text-[var(--color-text-muted)] hover:border-[var(--color-text-muted)]',
                      )}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-[var(--color-text-muted)]">
              Allowed labels
            </div>
            {labelsQuery.isLoading ? (
              <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
                Loading…
              </div>
            ) : labelOptions.length === 0 ? (
              <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
                No labels found on the trigger's repo.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {labelOptions.map((label) => {
                  const selected = value?.allowedLabels.includes(label.name) ?? false;
                  return (
                    <button
                      key={label.name}
                      type="button"
                      onClick={() => toggleLabel(label.name)}
                      className={cn(
                        'rounded-[var(--radius-sm)] border px-2 py-[3px] font-mono text-[11px] transition-colors',
                        selected
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-text)]'
                          : 'border-[var(--color-divider)] text-[var(--color-text-muted)] hover:border-[var(--color-text-muted)]',
                      )}
                    >
                      {label.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {value &&
            value.allowedStatuses.length === 0 &&
            value.allowedLabels.length === 0 && (
              <div className="font-mono text-[10.5px] text-[var(--color-text-muted)]">
                Pick at least one status or label — without selections, the
                writeback turn is skipped at run time.
              </div>
            )}
        </div>
      )}
    </div>
  );
}

function groupPresetsByCategory(
  presets: AgentPreset[],
): [string, AgentPreset[]][] {
  const groups = new Map<string, AgentPreset[]>();
  for (const p of presets) {
    const list = groups.get(p.category) ?? [];
    list.push(p);
    groups.set(p.category, list);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}
