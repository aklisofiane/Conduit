import type { DragEvent as ReactDragEvent } from 'react';
import type { AgentConfig } from '@conduit/shared';
import { tokens, providerStyle, type ProviderId } from '../../styles/theme.js';
import { Icon, ProviderGlyph } from './Icon.js';

export const PALETTE_DRAG_MIME = 'application/conduit-node';

export type PaletteDragPayload =
  | { kind: 'agent'; provider: AgentConfig['provider'] }
  | { kind: 'trigger' };

interface NodePaletteProps {
  onAddAgent: (provider: AgentConfig['provider']) => void;
  onSelectTrigger: () => void;
}

export function NodePalette({ onAddAgent, onSelectTrigger }: NodePaletteProps) {
  return (
    <aside
      className="flex w-[240px] shrink-0 flex-col gap-4 border-r px-[14px] py-4 text-[var(--color-text)]"
      style={{
        borderColor: tokens.color.divider,
        background: tokens.color.bgPanel,
      }}
    >
      <PaletteSection title="Triggers">
        <TriggerPaletteCard onClick={onSelectTrigger} />
      </PaletteSection>

      <PaletteSection title="Agents">
        <AgentPaletteCard
          provider="claude"
          name="Claude"
          description="opus · sonnet · haiku"
          onClick={() => onAddAgent('claude')}
        />
        <AgentPaletteCard
          provider="codex"
          name="Codex"
          description="gpt-5-codex"
          onClick={() => onAddAgent('codex')}
        />
      </PaletteSection>
    </aside>
  );
}

function PaletteSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className="mb-[6px] font-mono text-[10px] font-medium uppercase tracking-[0.06em]"
        style={{ color: tokens.color.textMuted }}
      >
        {title}
      </div>
      <div className="flex flex-col gap-[6px]">{children}</div>
    </div>
  );
}

function TriggerPaletteCard({ onClick }: { onClick: () => void }) {
  const payload: PaletteDragPayload = { kind: 'trigger' };
  return (
    <button
      type="button"
      draggable
      onDragStart={onPaletteDragStart(payload)}
      onClick={onClick}
      className="flex w-full items-start gap-[10px] rounded-[var(--radius)] border px-[10px] py-2 text-left transition-colors active:cursor-grabbing"
      style={{
        background: tokens.color.triggerBg,
        borderColor: tokens.color.triggerBorder,
      }}
    >
      <span
        className="mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px]"
        style={{ background: tokens.color.trigger }}
      >
        <Icon name="clock" size={11} color="#FFFFFF" />
      </span>
      <span className="min-w-0">
        <span className="block font-sans text-[12px] font-medium text-[var(--color-text)]">
          Trigger
        </span>
        <span
          className="block font-mono text-[11px]"
          style={{ color: tokens.color.textMuted }}
        >
          drag to place · click to focus
        </span>
      </span>
    </button>
  );
}

function AgentPaletteCard({
  provider,
  name,
  description,
  onClick,
}: {
  provider: ProviderId;
  name: string;
  description: string;
  onClick: () => void;
}) {
  const ps = providerStyle(provider);
  const payload: PaletteDragPayload = { kind: 'agent', provider };
  return (
    <button
      type="button"
      draggable
      onDragStart={onPaletteDragStart(payload)}
      onClick={onClick}
      className="relative flex w-full items-center gap-[10px] overflow-hidden rounded-[var(--radius-md)] border py-[10px] pl-[14px] pr-[10px] text-left transition-colors active:cursor-grabbing"
      style={{
        background: ps.card,
        borderColor: ps.border,
      }}
    >
      <span
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ background: ps.mark }}
      />
      <span
        className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[var(--radius-md)]"
        style={{ background: ps.mark }}
      >
        <ProviderGlyph provider={provider} size={14} color="#FFFFFF" />
      </span>
      <span className="min-w-0">
        <span
          className="block text-[12px] font-semibold text-[var(--color-text)]"
          style={{ fontFamily: ps.font }}
        >
          {name}
        </span>
        <span
          className="block font-mono text-[11px]"
          style={{ color: tokens.color.textMuted }}
        >
          {description}
        </span>
      </span>
    </button>
  );
}

function onPaletteDragStart(payload: PaletteDragPayload) {
  return (event: ReactDragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData(PALETTE_DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = 'move';
  };
}
