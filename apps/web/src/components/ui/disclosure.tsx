import { forwardRef } from 'react';
import { ChevronRight } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn.js';

/**
 * DisclosureButton — the collapse/expand header repeated by hand as a full-width
 * `<button aria-expanded>` with a rotating chevron and a `hover:bg-2` row tint
 * (workflow group headers, the run-timeline tool groups). The chevron and the
 * `aria-expanded` wiring are baked in; callers pass `open` and their own row
 * content. Geometry-only variants — colour/typography of the content stay with
 * the caller via `className`.
 *   - `md` : page-level group headers (px-4 py-2.5).
 *   - `sm` : dense list rows / nested timeline headers (px-3 py-2).
 */
const disclosureButtonVariants = cva(
  cn(
    'group flex w-full cursor-pointer items-center gap-3 text-left transition-colors',
    'hover:bg-[var(--color-pill-bg)]',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)] focus-visible:ring-inset',
    'disabled:cursor-not-allowed disabled:opacity-60',
  ),
  {
    variants: {
      size: {
        md: 'px-4 py-2.5',
        sm: 'px-3 py-2',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
);

export interface DisclosureButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof disclosureButtonVariants> {
  /** Whether the section this header controls is currently expanded. */
  open: boolean;
}

export const DisclosureButton = forwardRef<HTMLButtonElement, DisclosureButtonProps>(
  ({ className, size, open, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-expanded={open}
      className={cn(disclosureButtonVariants({ size }), className)}
      {...props}
    >
      <ChevronRight
        size={12}
        strokeWidth={2}
        aria-hidden
        className={cn(
          'shrink-0 text-[var(--color-text-muted)] transition-transform duration-150 group-hover:text-[var(--color-text)]',
          open && 'rotate-90',
        )}
      />
      {children}
    </button>
  ),
);
DisclosureButton.displayName = 'DisclosureButton';

export { disclosureButtonVariants };
