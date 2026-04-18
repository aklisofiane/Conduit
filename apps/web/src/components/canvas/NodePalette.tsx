import type { AgentConfig } from '@conduit/shared';

interface NodePaletteProps {
  onAddAgent: (provider: 'claude' | 'codex') => void;
}

/**
 * Left rail palette — mimics the mockup's design. Only "add agent" cards
 * are surfaced; triggers are editable via the trigger node click rather
 * than dragged from the palette (only one trigger per workflow).
 */
export function NodePalette({ onAddAgent }: NodePaletteProps) {
  return (
    <aside className="flex w-56 shrink-0 flex-col gap-5 border-r border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-4">
      <div>
        <h4 className="mb-2 px-1 font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-3)]">
          Agents
        </h4>
        <div className="space-y-1.5">
          <PaletteCard
            provider="claude"
            title="Claude"
            subtitle="opus · sonnet · haiku"
            onClick={() => onAddAgent('claude')}
          />
          <PaletteCard
            provider="codex"
            title="Codex"
            subtitle="gpt-5-codex"
            onClick={() => onAddAgent('codex')}
          />
        </div>
      </div>
      <div className="px-1 font-mono text-[10.5px] text-[var(--color-text-4)]">
        Click a card to drop an agent into the canvas. Connect it to an
        upstream node by dragging between handles.
      </div>
    </aside>
  );
}

function PaletteCard({
  provider,
  title,
  subtitle,
  onClick,
}: {
  provider: AgentConfig['provider'];
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-2 py-1.5 text-left transition-colors hover:border-[var(--color-text-2)]`}
    >
      <span
        className={`prov-glyph ${provider}`}
        style={{ width: 26, height: 26, fontSize: 13 }}
      >
        {provider === 'claude' ? 'C' : 'X'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[12px] font-medium">{title}</div>
        <div className="truncate font-mono text-[10.5px] text-[var(--color-text-3)]">{subtitle}</div>
      </div>
    </button>
  );
}
