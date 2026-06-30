import { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn.js';

/**
 * SelectableCard — the clickable card / list-row repeated by hand as a
 * `<button>` whose border (or fill) changes on hover and selection: MCP/template
 * picker cards, the create-workflow trigger rows, the run node-rail rows. Owns
 * only the bordered surface and its hover/selected treatment; layout (flex
 * direction, padding) and content stay with the caller via `className`.
 *
 * `tone` picks how emphasis is carried:
 *   - `neutral` : border tightens on hover/selected (picker cards).
 *   - `fill`    : background tints on hover/selected, border stays quiet
 *                 (dense rail rows).
 *   - `accent`  : primary border + soft fill + ring when selected (the
 *                 trigger-type chooser).
 * `rounded-md` is the default radius; override via `className` where a card
 * wants `rounded-lg` or `rounded-[var(--radius)]`.
 */
const selectableCardVariants = cva(
  cn(
    'w-full cursor-pointer rounded-md border text-left transition-colors',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)] focus-visible:ring-inset',
    'disabled:cursor-not-allowed disabled:opacity-60',
  ),
  {
    variants: {
      tone: {
        neutral: '',
        fill: '',
        accent: '',
      },
      selected: {
        true: '',
        false: '',
      },
    },
    compoundVariants: [
      {
        tone: 'neutral',
        selected: false,
        class: 'border-[var(--color-divider)] hover:border-[var(--color-divider)]',
      },
      { tone: 'neutral', selected: true, class: 'border-[var(--color-divider)]' },
      {
        tone: 'fill',
        selected: false,
        class: 'border-transparent hover:bg-[var(--color-pill-bg)]',
      },
      {
        tone: 'fill',
        selected: true,
        class: 'border-[var(--color-divider)] bg-[var(--color-pill-bg)]',
      },
      {
        tone: 'accent',
        selected: false,
        class: 'border-[var(--color-divider)] bg-[var(--color-bg)]',
      },
      {
        tone: 'accent',
        selected: true,
        class: cn(
          'border-[var(--color-primary)] bg-[var(--color-primary-soft,oklch(0.95_0.03_250))]',
          'shadow-[0_0_0_1px_var(--color-primary)]',
        ),
      },
    ],
    defaultVariants: {
      tone: 'neutral',
      selected: false,
    },
  },
);

export interface SelectableCardProps
  extends
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'>,
    VariantProps<typeof selectableCardVariants> {
  asChild?: boolean;
}

export const SelectableCard = forwardRef<HTMLButtonElement, SelectableCardProps>(
  ({ className, tone, selected, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        data-selected={selected || undefined}
        className={cn(selectableCardVariants({ tone, selected }), className)}
        {...(asChild ? {} : { type: 'button' as const })}
        {...props}
      />
    );
  },
);
SelectableCard.displayName = 'SelectableCard';

export { selectableCardVariants };
