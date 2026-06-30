import { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn.js';

/**
 * Node — the React-Flow node chrome that was hand-styled with inline
 * `style={{ background: ps.card, border: …, boxShadow: … }}` across
 * `AgentNode.tsx`, `trigger-node-common.tsx` and `NodePalette.tsx`. Because
 * `theme.ts` `providerStyle()`/`tokens.color.*` return only `var(--color-*)`
 * strings, every inline colour moves verbatim into a `cva` class keyed by a
 * `tone` axis — a migrated node renders pixel-identical to the old markup.
 *
 * Numeric sizing (`width`/`minHeight` from `nodeSize`) stays inline via the
 * forwarded `style` prop; only colours, borders, shadow and font-family live
 * here. Mirror the provider `compoundVariants` precedent in `ui/badge.tsx`.
 */

/**
 * NodeShell — the outer node container (AgentNode root, `TriggerNodeShell`
 * root, and — via `asChild` — the palette `<button>` cards). `tone` paints the
 * card background, resting border and font-family; `selected` swaps the border
 * to the provider mark / accent and layers the focus shadow under the node
 * shadow. Callers still pass `style={{ width, minHeight }}` for sizing.
 */
const nodeShellVariants = cva(
  'overflow-hidden rounded-[var(--radius)] border transition-all text-[var(--color-text)]',
  {
    variants: {
      tone: {
        claude:
          'bg-[var(--color-claude-card)] border-[var(--color-claude-border)] font-sans',
        codex:
          'bg-[var(--color-codex-card)] border-[var(--color-codex-border)] font-mono',
        trigger:
          'bg-[var(--color-trigger-bg)] border-[var(--color-trigger-border)] font-mono',
      },
      selected: {
        true: 'shadow-[var(--shadow-focus),var(--shadow-node)]',
        false: 'shadow-[var(--shadow-node)]',
      },
    },
    compoundVariants: [
      { tone: 'claude', selected: true, class: 'border-[var(--color-claude-mark)]' },
      { tone: 'codex', selected: true, class: 'border-[var(--color-codex-mark)]' },
      { tone: 'trigger', selected: true, class: 'border-[var(--color-accent)]' },
    ],
    defaultVariants: {
      tone: 'claude',
      selected: false,
    },
  },
);

export interface NodeShellProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof nodeShellVariants> {
  /** Render as the child element (e.g. the palette `<button>`) instead of a `<div>`. */
  asChild?: boolean;
}

export const NodeShell = forwardRef<HTMLDivElement, NodeShellProps>(
  ({ className, tone, selected, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'div';
    return (
      <Comp
        ref={ref}
        className={cn(nodeShellVariants({ tone, selected }), className)}
        {...props}
      />
    );
  },
);
NodeShell.displayName = 'NodeShell';

/**
 * NodeIconTile — the small square provider/trigger glyph tile (the
 * `grid place-items-center` span holding a `ProviderGlyph` or trigger icon).
 * `tone` paints the mark/trigger background; `size` covers the three tile
 * dimensions in use: `sm` (18px, trigger nodes + palette trigger card), `md`
 * (22px, agent node header) and `lg` (26px, agent palette card). The glyph
 * itself is passed as children.
 */
const nodeIconTileVariants = cva('grid shrink-0 place-items-center', {
  variants: {
    tone: {
      claude: 'bg-[var(--color-claude-mark)]',
      codex: 'bg-[var(--color-codex-mark)]',
      trigger: 'bg-[var(--color-trigger)]',
    },
    size: {
      sm: 'h-[18px] w-[18px] rounded-[5px]',
      md: 'h-[22px] w-[22px] rounded-[var(--radius)]',
      lg: 'h-[26px] w-[26px] rounded-[var(--radius-md)]',
    },
  },
  defaultVariants: {
    tone: 'claude',
    size: 'md',
  },
});

export interface NodeIconTileProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof nodeIconTileVariants> {}

export const NodeIconTile = forwardRef<HTMLSpanElement, NodeIconTileProps>(
  ({ className, tone, size, ...props }, ref) => (
    <span ref={ref} className={cn(nodeIconTileVariants({ tone, size }), className)} {...props} />
  ),
);
NodeIconTile.displayName = 'NodeIconTile';

/**
 * NodeTag — the uppercase mono tag at the node header's right edge: AgentNode's
 * provider `ProviderTag` (`claude`/`codex`) and `TriggerNodeShell`'s platform
 * pill (`neutral`). The provider tones use the provider tag colours; `neutral`
 * uses the shared pill surface and adds a divider border. Padding/weight differ
 * per tone (the platform pill is a touch tighter), so both fold into the tone
 * variant to keep call sites to a single `tone` prop.
 */
const nodeTagVariants = cva(
  'ml-auto rounded-[var(--radius-sm)] px-[6px] font-mono text-caption uppercase tracking-[0.06em]',
  {
    variants: {
      tone: {
        claude:
          'py-[2px] font-semibold bg-[var(--color-claude-tag-bg)] text-[var(--color-claude-tag-text)]',
        codex:
          'py-[2px] font-semibold bg-[var(--color-codex-tag-bg)] text-[var(--color-codex-tag-text)]',
        neutral:
          'border py-[1px] bg-[var(--color-pill-bg)] text-[var(--color-text-2)] border-[var(--color-pill-border)]',
      },
    },
    defaultVariants: {
      tone: 'claude',
    },
  },
);

export interface NodeTagProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof nodeTagVariants> {}

export const NodeTag = forwardRef<HTMLSpanElement, NodeTagProps>(
  ({ className, tone, ...props }, ref) => (
    <span ref={ref} className={cn(nodeTagVariants({ tone }), className)} {...props} />
  ),
);
NodeTag.displayName = 'NodeTag';

/**
 * NodePill — AgentNode's model/meta pill: a mono pill tinted with the
 * provider's prompt-sheet surface (`--color-<p>-prompt`) and prompt border.
 * `tone` is `claude` | `codex`; children carry the pill's text.
 */
const nodePillVariants = cva(
  'inline-flex items-center gap-[6px] rounded-[var(--radius-sm)] border px-[6px] py-[2px] font-mono text-caption',
  {
    variants: {
      tone: {
        claude: 'bg-[var(--color-claude-prompt)] border-[var(--color-claude-prompt-border)]',
        codex: 'bg-[var(--color-codex-prompt)] border-[var(--color-codex-prompt-border)]',
      },
    },
    defaultVariants: {
      tone: 'claude',
    },
  },
);

export interface NodePillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof nodePillVariants> {}

export const NodePill = forwardRef<HTMLSpanElement, NodePillProps>(
  ({ className, tone, ...props }, ref) => (
    <span ref={ref} className={cn(nodePillVariants({ tone }), className)} {...props} />
  ),
);
NodePill.displayName = 'NodePill';

export { nodeShellVariants, nodeIconTileVariants, nodeTagVariants, nodePillVariants };
