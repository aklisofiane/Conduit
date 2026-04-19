import type { DragEvent as ReactDragEvent } from 'react';
import type { AgentConfig } from '@conduit/shared';

export const PALETTE_DRAG_MIME = 'application/conduit-node';

export type PaletteDragPayload =
  | { kind: 'agent'; provider: AgentConfig['provider'] }
  | { kind: 'trigger' };

interface NodePaletteProps {
  onAddAgent: (provider: AgentConfig['provider']) => void;
  onSelectTrigger: () => void;
}

/**
 * Left rail palette — cards are both click-to-add and drag-to-place onto the
 * canvas (see `handleDrop` in CanvasPage). Triggers remain a singleton per
 * workflow; the trigger card repositions (or re-reveals) the existing one.
 */
export function NodePalette({ onAddAgent, onSelectTrigger }: NodePaletteProps) {
  return (
    <aside className="flex w-56 shrink-0 flex-col gap-5 border-r border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-4">
      <div>
        <h4 className="mb-2 px-1 font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-3)]">
          Trigger
        </h4>
        <div className="space-y-1.5">
          <TriggerPaletteCard onClick={onSelectTrigger} />
        </div>
      </div>
      <div>
        <h4 className="mb-2 px-1 font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-3)]">
          Agents
        </h4>
        <div className="space-y-1.5">
          <AgentPaletteCard
            provider="claude"
            title="Claude"
            subtitle="opus · sonnet · haiku"
            onClick={() => onAddAgent('claude')}
          />
          <AgentPaletteCard
            provider="codex"
            title="Codex"
            subtitle="gpt-5-codex"
            onClick={() => onAddAgent('codex')}
          />
        </div>
      </div>
      <div className="px-1 font-mono text-[10.5px] text-[var(--color-text-4)]">
        Click to add at canvas center, or drag onto the canvas to drop at the
        pointer. Connect agents by dragging between handles.
      </div>
    </aside>
  );
}

function AgentPaletteCard({
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
  const onDragStart = (event: ReactDragEvent<HTMLButtonElement>) => {
    const payload: PaletteDragPayload = { kind: 'agent', provider };
    event.dataTransfer.setData(PALETTE_DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = 'move';
  };
  return (
    <button
      onClick={onClick}
      draggable
      onDragStart={onDragStart}
      className="flex w-full items-center gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-2 py-1.5 text-left transition-colors hover:border-[var(--color-text-2)] active:cursor-grabbing"
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

function TriggerPaletteCard({ onClick }: { onClick: () => void }) {
  const onDragStart = (event: ReactDragEvent<HTMLButtonElement>) => {
    const payload: PaletteDragPayload = { kind: 'trigger' };
    event.dataTransfer.setData(PALETTE_DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = 'move';
  };
  return (
    <button
      onClick={onClick}
      draggable
      onDragStart={onDragStart}
      className="flex w-full items-center gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-2 py-1.5 text-left transition-colors hover:border-[var(--color-text-2)] active:cursor-grabbing"
    >
      <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] text-[var(--color-text-2)]">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[12px] font-medium">Trigger</div>
        <div className="truncate font-mono text-[10.5px] text-[var(--color-text-3)]">
          drag to place · click to focus
        </div>
      </div>
    </button>
  );
}
