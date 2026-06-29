import { createContext, forwardRef, useContext } from 'react';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn.js';

/**
 * ToggleGroup — the segmented-control / tab-strip family that earlier waves left
 * as raw `<button>`s because no single Button variant matched every active
 * state. Built on Radix `ToggleGroup` so:
 *   - `type="single"` is a tab strip / radio segmented control,
 *   - `type="multiple"` is a multi-select segmented control (e.g. weekday picker),
 * and roving-tabindex, arrow-key navigation and radio/group ARIA come for free.
 *
 * `variant` controls the *on* look, `size` the geometry; both are inherited by
 * items from the Root via context, so callers usually set them once on Root.
 *   - `subtle`  : neutral pill fill when on (content tabs, write/preview).
 *   - `solid`   : accent fill + white text when on (weekday cells, cloud/self).
 *   - `outline` : bordered box + bg-panel when on (Canvas/Runs workflow tabs).
 * Off-palette active colours (e.g. the claude-orange template mode toggle) are a
 * per-item `className` override targeting `data-[state=on]:…`.
 */
const toggleGroupItemVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer',
    'font-mono transition-colors',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)] focus-visible:ring-inset',
    'disabled:cursor-not-allowed disabled:opacity-60',
  ),
  {
    variants: {
      variant: {
        subtle: cn(
          'rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
          'data-[state=on]:bg-[var(--color-pill-bg)] data-[state=on]:text-[var(--color-text)]',
        ),
        solid: cn(
          'bg-[var(--color-pill-bg)] text-[var(--color-text-muted)] hover:bg-[var(--color-divider)]',
          'data-[state=on]:bg-[var(--color-accent)] data-[state=on]:text-white data-[state=on]:hover:bg-[var(--color-accent)]',
        ),
        outline: cn(
          'border border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
          'data-[state=on]:border-[var(--color-divider)] data-[state=on]:bg-[var(--color-bg)] data-[state=on]:font-medium data-[state=on]:text-[var(--color-text)]',
        ),
      },
      size: {
        sm: 'h-6 rounded-[var(--radius-sm)] px-2 text-[10.5px]',
        md: 'h-7 rounded-[var(--radius)] px-2.5 text-[11px]',
        box: 'h-8 w-10 rounded-[var(--radius-sm)] text-[11px] font-medium',
        pill: 'rounded-full px-3 py-1 text-[11px]',
      },
    },
    defaultVariants: {
      variant: 'subtle',
      size: 'md',
    },
  },
);

type ToggleGroupVariants = VariantProps<typeof toggleGroupItemVariants>;

const ToggleGroupContext = createContext<ToggleGroupVariants>({});

export type ToggleGroupProps = React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> &
  ToggleGroupVariants;

export const ToggleGroup = forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  ToggleGroupProps
>(({ className, variant, size, children, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn('inline-flex items-center gap-1', className)}
    {...props}
  >
    <ToggleGroupContext.Provider value={{ variant, size }}>{children}</ToggleGroupContext.Provider>
  </ToggleGroupPrimitive.Root>
));
ToggleGroup.displayName = 'ToggleGroup';

export interface ToggleGroupItemProps
  extends React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>,
    ToggleGroupVariants {}

export const ToggleGroupItem = forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  ToggleGroupItemProps
>(({ className, variant, size, children, ...props }, ref) => {
  const ctx = useContext(ToggleGroupContext);
  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      className={cn(
        toggleGroupItemVariants({
          variant: variant ?? ctx.variant,
          size: size ?? ctx.size,
        }),
        className,
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  );
});
ToggleGroupItem.displayName = 'ToggleGroupItem';

export { toggleGroupItemVariants };
