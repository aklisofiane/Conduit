import { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn.js';

/**
 * Card — the bordered panel repeated by hand across pages as
 * `rounded-lg border border-[var(--color-divider)] bg-[var(--color-bg-panel)]`.
 * `padded` toggles the standard inner padding off for surfaces that own their
 * own layout (e.g. a list whose rows draw their own dividers).
 */
const cardVariants = cva('rounded-lg border border-[var(--color-divider)] bg-[var(--color-bg-panel)]', {
  variants: {
    padded: {
      true: 'p-4',
      false: 'overflow-hidden',
    },
  },
  defaultVariants: {
    padded: true,
  },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, padded, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ padded }), className)} {...props} />
  ),
);
Card.displayName = 'Card';

export { cardVariants };
