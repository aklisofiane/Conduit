import { forwardRef } from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { cva, type VariantProps } from 'class-variance-authority';
import { Check } from 'lucide-react';
import { cn } from '../../lib/cn.js';

/**
 * Checkbox — Radix-backed replacement for the raw `<input type="checkbox">`
 * elements scattered across the panels. The native input was uncovered by the
 * `Input` primitive (which is a text-field `cva`), so checkboxes stayed raw
 * until now. Styling maps onto the same token system as `Button` — accent fill
 * + focus ring on check — so it sits flush next to migrated controls.
 *
 * Unlike the native input it fires `onCheckedChange(boolean)` (Radix), not
 * `onChange(event)`; callers read the boolean directly instead of
 * `e.target.checked`.
 */
const checkboxVariants = cva(
  cn(
    'peer shrink-0 inline-flex items-center justify-center',
    'rounded-[4px] border border-[var(--color-divider)] bg-[var(--color-bg)]',
    'cursor-pointer transition-[background-color,border-color,box-shadow] duration-150 ease-out',
    'focus-visible:outline-none focus-visible:border-[var(--color-accent)] focus-visible:shadow-[var(--shadow-focus)]',
    'disabled:cursor-not-allowed disabled:opacity-[0.45]',
    'data-[state=checked]:bg-[var(--color-primary)] data-[state=checked]:border-[var(--color-primary-border)] data-[state=checked]:text-[var(--color-primary-text)]',
  ),
  {
    variants: {
      size: {
        sm: 'h-[14px] w-[14px]',
        md: 'h-4 w-4',
      },
    },
    defaultVariants: {
      size: 'sm',
    },
  },
);

export interface CheckboxProps
  extends React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>,
    VariantProps<typeof checkboxVariants> {}

export const Checkbox = forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(({ className, size, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(checkboxVariants({ size }), className)}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      <Check size={11} strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = 'Checkbox';

export { checkboxVariants };
