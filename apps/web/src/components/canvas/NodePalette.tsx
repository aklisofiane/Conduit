import type { DragEvent as ReactDragEvent, ReactNode } from 'react';
import type { AgentConfig } from '@conduit/shared';
import { tokens, providerStyle, type ProviderId } from '../../styles/theme.js';
import { CircleDot, Clock, GitPullRequest } from 'lucide-react';
import { ProviderGlyph } from '../common/BrandGlyph.js';

export const PALETTE_DRAG_MIME = 'application/conduit-node';

/**
 * Drag payload contract between the palette and the canvas drop handler.
 * Triggers are typed at drag time so the canvas knows which default
 * config to materialize. Adding a future webhook card means extending the
 * `triggerType` union here and adding a corresponding case in the drop
 * handler.
 */
export type PaletteTriggerType = 'issues' | 'pull_requests' | 'cron';

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

export function NodePalette({
  onAddAgent,
  onAddTrigger,
  triggerSlotFilled,
}: NodePaletteProps) {
  return (
    <aside
      className="flex w-[240px] shrink-0 flex-col gap-4 border-r px-[14px] py-4 text-[var(--color-text)]"
      style={{
        borderColor: tokens.color.divider,
        background: tokens.color.bgPanel,
      }}
    >
      <PaletteSection title="Triggers">
        <TriggerPaletteCard
          name="Issues"
          description="github issues — board or repo"
          icon={<CircleDot size={11} color="#FFFFFF" strokeWidth={1.5} />}
          disabled={triggerSlotFilled}
          payload={{ kind: 'trigger', triggerType: 'issues' }}
          onClick={() => onAddTrigger('issues')}
        />
        <TriggerPaletteCard
          name="Pull requests"
          description="open prs in the repo"
          icon={<GitPullRequest size={11} color="#FFFFFF" strokeWidth={1.5} />}
          disabled={triggerSlotFilled}
          payload={{ kind: 'trigger', triggerType: 'pull_requests' }}
          onClick={() => onAddTrigger('pull_requests')}
        />
        <TriggerPaletteCard
          name="Schedule"
          description="time-driven runs on a branch"
          icon={<Clock size={11} color="#FFFFFF" strokeWidth={1.5} />}
          disabled={triggerSlotFilled}
          payload={{ kind: 'trigger', triggerType: 'cron' }}
          onClick={() => onAddTrigger('cron')}
        />
        {triggerSlotFilled && (
          <div className="px-[2px] font-mono text-[10px] leading-[1.3] text-[var(--color-text-muted)]">
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
    <button
      type="button"
      draggable={!disabled}
      onDragStart={disabled ? undefined : onPaletteDragStart(payload)}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className="flex w-full items-start gap-[10px] rounded-[var(--radius)] border px-[10px] py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 active:cursor-grabbing"
      style={{
        background: tokens.color.triggerBg,
        borderColor: tokens.color.triggerBorder,
      }}
    >
      <span
        className="mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px]"
        style={{ background: tokens.color.trigger }}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-sans text-[12px] font-medium text-[var(--color-text)]">
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
