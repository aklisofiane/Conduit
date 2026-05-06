import type { PointerEvent as ReactPointerEvent } from 'react';
import type { AgentConfig } from '@conduit/shared';
import { useAgentPresets, useSkills } from '../../api/hooks.js';
import type { AgentPreset } from '../../api/types.js';
import { cn } from '../../lib/cn.js';
import { providerStyle } from '../../styles/theme.js';
import { Icon } from './Icon.js';
import { McpServerPicker } from './McpServerPicker.js';
import { ResizeHandle } from './ResizeHandle.js';

interface AgentConfigPanelProps {
  agent: AgentConfig;
  workflowId: string;
  width: number;
  onResizeStart: (event: ReactPointerEvent) => void;
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
  width,
  onResizeStart,
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
    <aside
      className="relative flex shrink-0 flex-col border-l border-[var(--color-divider)] bg-[var(--color-bg-panel)]"
      style={{ width }}
    >
      <ResizeHandle onPointerDown={onResizeStart} />
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
                onChange={(e) =>
                  onChange({ provider: e.target.value as AgentConfig['provider'] })
                }
              >
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
              </select>
              <select
                className="field-input"
                value={agent.model}
                onChange={(e) => onChange({ model: e.target.value })}
              >
                {modelsFor(agent.provider).map((m) => (
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
    </aside>
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

function modelsFor(provider: AgentConfig['provider']): string[] {
  if (provider === 'codex') return ['gpt-5-codex'];
  return ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'];
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
