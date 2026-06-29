import { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn.js';

/**
 * Input / Textarea — canonical replacement for the global `.field-input`
 * class in `globals.css`. The base styles map 1:1 onto the old CSS so a
 * migrated field is visually identical; the `textarea` element picks up the
 * auto-height / vertical-resize tweaks the old `textarea.field-input` rule
 * applied.
 */
const inputVariants = cva(
  cn(
    'w-full bg-[var(--color-bg)] border border-[var(--color-divider)] rounded-[var(--radius)]',
    'text-[var(--color-text)] outline-none',
    'transition-[border-color,box-shadow] duration-[120ms] ease-[ease]',
    'placeholder:text-[var(--color-text-muted)] placeholder:opacity-100',
    'focus:border-[var(--color-accent)] focus:shadow-[var(--shadow-focus)]',
  ),
  {
    variants: {
      // The two form controls share every style except sizing/padding.
      as: {
        input: 'h-[30px] px-[10px] font-sans text-[12px]',
        textarea: 'h-auto py-2 px-[10px] resize-y font-sans text-[12px]',
      },
      // `compact` is the dense pill-field look used in popovers/menus (filter
      // boxes, inline create-org): auto height, tighter radius/padding, mono,
      // and a muted focus border with no focus shadow. Collapses the per-site
      // "re-declare the base then cancel the defaults" className soup.
      variant: {
        default: '',
        compact:
          'h-auto rounded-[var(--radius-sm)] px-2 py-1 font-mono text-[11px] focus:border-[var(--color-text-muted)] focus:shadow-none',
      },
    },
    defaultVariants: {
      as: 'input',
      variant: 'default',
    },
  },
);

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement>,
    Pick<VariantProps<typeof inputVariants>, 'variant'> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, variant, ...props }, ref) => (
    <input ref={ref} className={cn(inputVariants({ as: 'input', variant }), className)} {...props} />
  ),
);
Input.displayName = 'Input';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(inputVariants({ as: 'textarea' }), className)} {...props} />
  ),
);
Textarea.displayName = 'Textarea';

export { inputVariants };
