import { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn.js';

/**
 * Badge — the labeled-pill / chip / provider-tile family that was hand-styled as
 * the global `.pill`, `.chip` and `.prov-glyph` classes in `globals.css`. The
 * spec deferred this primitive until "a labeled pill carries info a dot can't";
 * it now folds all three shells onto one token-driven `cva` so a migrated badge
 * is visually identical to the old markup.
 *
 * - `variant="pill"` (default): the live status pill (`bg-panel`, divider border).
 * - `variant="chip"`: the denser mono chip; `provider` tints it claude/codex.
 * - `variant="glyph"`: the 18px square provider tile (the canvas-external "C"/"X").
 *
 * Pair with {@link BadgeDot} for the leading status dot.
 */
const badgeVariants = cva('inline-flex items-center', {
  variants: {
    variant: {
      pill: cn(
        'gap-1.5 rounded-full border px-2.5 py-[3px] font-mono text-small',
        'border-[var(--color-divider)] bg-[var(--color-bg-panel)] text-[var(--color-text-2)]',
      ),
      chip: cn(
        'gap-[5px] rounded-full border px-2 py-0.5 font-mono text-caption',
        'border-[var(--color-pill-border)] bg-[var(--color-pill-bg)] text-[var(--color-text-2)]',
      ),
      glyph:
        'h-[18px] w-[18px] justify-center rounded-[var(--radius-sm)] font-mono text-small font-bold',
    },
    provider: {
      none: '',
      claude: '',
      codex: '',
    },
  },
  compoundVariants: [
    {
      variant: 'chip',
      provider: 'claude',
      class:
        'border-[var(--color-claude-border)] bg-[var(--color-claude-tag-bg)] text-[var(--color-claude-tag-text)]',
    },
    {
      variant: 'chip',
      provider: 'codex',
      class:
        'border-[var(--color-codex-border)] bg-[var(--color-codex-tag-bg)] text-[var(--color-codex-tag-text)]',
    },
    { variant: 'glyph', provider: 'claude', class: 'bg-[var(--color-claude-mark)] text-white' },
    { variant: 'glyph', provider: 'codex', class: 'bg-[var(--color-codex-mark)] text-white' },
  ],
  defaultVariants: {
    variant: 'pill',
    provider: 'none',
  },
});

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Render as the child element (e.g. a `<button>`) instead of a `<span>`. */
  asChild?: boolean;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, provider, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'span';
    return (
      <Comp ref={ref} className={cn(badgeVariants({ variant, provider }), className)} {...props} />
    );
  },
);
Badge.displayName = 'Badge';

/**
 * BadgeDot — the small leading status dot inside a {@link Badge} (the old
 * `.pill .dot` / `.chip .dot`). `tone` covers the common states; callers that
 * need an off-palette colour can still pass `className` (or `style`) to override.
 */
const badgeDotVariants = cva('inline-block shrink-0 rounded-full', {
  variants: {
    size: {
      pill: 'h-1.5 w-1.5',
      chip: 'h-[5px] w-[5px]',
    },
    tone: {
      success: 'bg-[var(--color-success)]',
      error: 'bg-[var(--color-error)]',
      muted: 'bg-[var(--color-text-muted)]',
    },
  },
  defaultVariants: {
    size: 'pill',
    tone: 'success',
  },
});

export interface BadgeDotProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeDotVariants> {}

export const BadgeDot = forwardRef<HTMLSpanElement, BadgeDotProps>(
  ({ className, size, tone, ...props }, ref) => (
    <span ref={ref} className={cn(badgeDotVariants({ size, tone }), className)} {...props} />
  ),
);
BadgeDot.displayName = 'BadgeDot';

export { badgeVariants };
