import type { AgentConfig } from '@conduit/shared';
import { useSkills } from '../../api/hooks.js';
import { cn } from '../../lib/cn.js';

interface AgentConfigPanelProps {
  agent: AgentConfig;
  onChange: (patch: Partial<AgentConfig>) => void;
  onSave: () => void;
  onDiscard: () => void;
  saving: boolean;
  dirty: boolean;
}

/**
 * Matches the mockup's right-hand side panel: name, provider+model, instructions,
 * MCP picker, skill picker, workspace picker. Validation deferred to save time
 * (Zod schema at API boundary).
 */
export function AgentConfigPanel({
  agent,
  onChange,
  onSave,
  onDiscard,
  saving,
  dirty,
}: AgentConfigPanelProps) {
  const { data: skills = [] } = useSkills();
  const providerSkills = skills.filter(
    (s) => s.provider === 'both' || s.provider === agent.provider,
  );

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-[var(--color-line)] bg-[var(--color-bg-1)]">
      <div className="border-b border-[var(--color-line)] px-5 py-4">
        <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-3)]">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: agent.provider === 'claude' ? 'var(--color-claude)' : 'var(--color-codex)',
              boxShadow: `0 0 6px ${agent.provider === 'claude' ? 'var(--color-claude)' : 'var(--color-codex)'}`,
            }}
          />
          Agent · {agent.provider === 'claude' ? 'Claude' : 'Codex'}
        </div>
        <h3 className="mt-2 font-mono text-[15px] font-semibold">
          <span>{agent.name}</span>
          <span className="text-[var(--color-text-4)]"> · config</span>
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-5">
          <Field label="Name" hint="identifier · used as .conduit/<Name>.md">
            <input
              className="field-input"
              value={agent.name}
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </Field>

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
              <option value="ticket-branch">ticket-branch (phase 5)</option>
            </select>
          </Field>

          <Field label="Skills" hint="from .claude/skills/">
            {providerSkills.length === 0 ? (
              <div className="font-mono text-[11px] text-[var(--color-text-4)]">
                No skills discovered. Add SKILL.md files under .claude/skills/ on the worker or in a connected repo.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-1.5">
                {providerSkills.map((skill) => {
                  const selected = agent.skills.some((s) => s.skillId === skill.id);
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
                        'rounded-md border p-2 text-left transition-colors',
                        selected
                          ? agent.provider === 'claude'
                            ? 'border-[var(--color-claude-border)] bg-[var(--color-claude-bg)]'
                            : 'border-[var(--color-codex-border)] bg-[var(--color-codex-bg)]'
                          : 'border-[var(--color-line)] bg-[var(--color-bg-2)] hover:border-[var(--color-line-2)]',
                      )}
                    >
                      <div className="flex items-center gap-2 font-mono text-[12px] font-medium">
                        <span
                          className={
                            agent.provider === 'claude'
                              ? 'text-[var(--color-claude)]'
                              : 'text-[var(--color-codex)]'
                          }
                        >
                          ✶
                        </span>
                        {skill.name}
                      </div>
                      {skill.description && (
                        <div className="mt-1 font-mono text-[10.5px] text-[var(--color-text-3)]">
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
