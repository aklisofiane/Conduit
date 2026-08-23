import type { DragEvent as ReactDragEvent, ReactNode } from 'react';
import type { AgentConfig } from '@conduit/shared';
import { type ProviderId } from '../../styles/theme.js';
import { cn } from '../../lib/cn.js';
import { NodeShell, NodeIconTile } from '../ui/node.js';
import { ProviderGlyph } from '../common/BrandGlyph.js';
import { ADDABLE_TRIGGERS, type PaletteTriggerType } from './trigger-registry.js';

export const PALETTE_DRAG_MIME = 'application/conduit-node';

export type { PaletteTriggerType };

/**
 * Drag payload contract between the palette and the canvas drop handler.
 * Triggers are typed at drag time so the canvas knows which default
 * config to materialize. The addable trigger variants come from the
 * trigger registry — adding one there extends the cards and this union.
 */
export type PaletteDragPayload =
  | { kind: 'agent'; provider: AgentConfig['provider'] }
  | { kind: 'trigger'; triggerType: PaletteTriggerType };

interface NodePaletteProps {
  onAddAgent: (provider: AgentConfig['provider']) => void;
  onAddTrigger: (triggerType: PaletteTriggerType) => void;
  /** Whether a trigger already exists — disables the typed cards so the
   *  user is funnelled through delete-then-add to swap kinds. */
  triggerSlotFilled: boolean;
}

export function NodePalette({ onAddAgent, onAddTrigger, triggerSlotFilled }: NodePaletteProps) {
  return (
    <aside className="flex w-[240px] shrink-0 flex-col gap-4 border-r border-[var(--color-divider)] bg-[var(--color-bg-panel)] px-[14px] py-4 text-[var(--color-text)]">
      <PaletteSection title="Triggers">
        {ADDABLE_TRIGGERS.map(({ type, palette }) => (
          <TriggerPaletteCard
            key={type}
            name={palette.name}
            description={palette.description}
            icon={palette.icon}
            disabled={triggerSlotFilled}
            payload={{ kind: 'trigger', triggerType: type }}
            onClick={() => onAddTrigger(type)}
          />
        ))}
        {triggerSlotFilled && (
          <div className="px-[2px] font-mono text-caption leading-[1.3] text-[var(--color-text-muted)]">
            Delete the existing trigger to add a different kind.
          </div>
        )}
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
          description="gpt-5 family · codex"
          onClick={() => onAddAgent('codex')}
        />
      </PaletteSection>
    </aside>
  );
}

function PaletteSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-[6px] font-mono text-caption font-medium uppercase tracking-[0.06em] text-[var(--color-text-muted)]">
        {title}
      </div>
      <div className="flex flex-col gap-[6px]">{children}</div>
    </div>
  );
}

function TriggerPaletteCard({
  name,
  description,
  icon,
  payload,
  disabled,
  onClick,
}: {
  name: string;
  description: string;
  icon: ReactNode;
  payload: PaletteDragPayload;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <NodeShell
      asChild
      tone="trigger"
      className="flex w-full items-start gap-[10px] px-[10px] py-2 text-left shadow-none transition-colors disabled:cursor-not-allowed disabled:opacity-50 active:cursor-grabbing"
    >
      <button
        type="button"
        draggable={!disabled}
        onDragStart={disabled ? undefined : onPaletteDragStart(payload)}
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
      >
        <NodeIconTile tone="trigger" size="sm" className="mt-[1px]">
          {icon}
        </NodeIconTile>
        <span className="min-w-0">
          <span className="block font-sans text-small font-medium text-[var(--color-text)]">
            {name}
          </span>
          <span className="block font-mono text-small text-[var(--color-text-muted)]">
            {description}
          </span>
        </span>
      </button>
    </NodeShell>
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
  const payload: PaletteDragPayload = { kind: 'agent', provider };
  return (
    <NodeShell
      asChild
      tone={provider}
      className="relative flex w-full items-center gap-[10px] rounded-[var(--radius-md)] py-[10px] pl-[14px] pr-[10px] text-left shadow-none transition-colors active:cursor-grabbing"
    >
      <button type="button" draggable onDragStart={onPaletteDragStart(payload)} onClick={onClick}>
        <span
          aria-hidden
          className={cn(
            'absolute left-0 top-0 bottom-0 w-1',
            provider === 'claude'
              ? 'bg-[var(--color-claude-mark)]'
              : 'bg-[var(--color-codex-mark)]',
          )}
        />
        <NodeIconTile tone={provider} size="lg">
          <ProviderGlyph provider={provider} size={14} color="#FFFFFF" />
        </NodeIconTile>
        <span className="min-w-0">
          <span
            className={cn(
              'block text-small font-semibold text-[var(--color-text)]',
              provider === 'claude' ? 'font-sans' : 'font-mono',
            )}
          >
            {name}
          </span>
          <span className="block font-mono text-small text-[var(--color-text-muted)]">
            {description}
          </span>
        </span>
      </button>
    </NodeShell>
  );
}

function onPaletteDragStart(payload: PaletteDragPayload) {
  return (event: ReactDragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData(PALETTE_DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = 'move';
  };
}
