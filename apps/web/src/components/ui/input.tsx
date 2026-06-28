import { forwardRef } from 'react';
import { cva } from 'class-variance-authority';
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
    },
    defaultVariants: {
      as: 'input',
    },
  },
);

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(inputVariants({ as: 'input' }), className)} {...props} />
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
