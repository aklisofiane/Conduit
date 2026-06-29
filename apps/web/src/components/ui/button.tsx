import { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn.js';

/**
 * Button — canonical replacement for the global `.btn` / `.btn.primary` /
 * `.btn.danger` classes in `globals.css`. Variants map 1:1 onto the existing
 * token system so a migrated button is visually identical to the old markup;
 * `ghost` is the one addition, for borderless icon affordances.
 */
const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap',
    'rounded-[var(--radius)] border font-medium cursor-pointer',
    'transition-[background-color,border-color,color,box-shadow] duration-150 ease-out',
    'focus-visible:outline-none focus-visible:border-[var(--color-accent)] focus-visible:shadow-[var(--shadow-focus)]',
    'disabled:cursor-not-allowed disabled:opacity-[0.45]',
  ),
  {
    variants: {
      variant: {
        secondary:
          'border-[var(--color-divider)] bg-[var(--color-bg)] text-[var(--color-text)] hover:bg-[var(--color-pill-bg)] hover:border-[var(--color-text-muted)]',
        primary:
          'border-[var(--color-primary-border)] bg-[var(--color-primary)] text-[var(--color-primary-text)] hover:bg-[var(--color-primary-border)]',
        danger:
          'border-[color-mix(in_oklch,var(--color-error)_30%,transparent)] bg-[var(--color-bg)] text-[var(--color-error)] hover:bg-[var(--color-pill-bg)]',
        ghost:
          'border-transparent bg-transparent text-[var(--color-text-3)] hover:bg-[var(--color-bg-2)] hover:text-[var(--color-text)]',
        link: 'border-transparent bg-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
      },
      size: {
        md: 'h-7 px-3 text-[11.5px]',
        sm: 'h-6 px-2 text-[11px]',
        icon: 'h-6 w-6 p-0',
        inline: 'h-auto p-0 text-[11px]',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
