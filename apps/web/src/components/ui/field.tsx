import { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../../lib/cn.js';

/**
 * Label / Hint / Field — canonical replacement for the global `.field-label`
 * trio in `globals.css`. `Label` carries the uppercase mono caption styling;
 * `Hint` is the de-emphasised inline note that `.field-label .hint` produced.
 * `Field` is the label + control + error composite the auth and account forms
 * repeated by hand (see the old `FormField`).
 */
const labelClass = cn(
  'flex items-center gap-[8px] mb-[6px] font-medium',
  'font-mono text-[10px] tracking-[0.06em] uppercase text-[var(--color-text-muted)]',
);

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  asChild?: boolean;
}

export const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'label';
    return <Comp ref={ref} className={cn(labelClass, className)} {...props} />;
  },
);
Label.displayName = 'Label';

/** De-emphasised inline note rendered alongside a Label caption. */
export function Hint({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('font-normal normal-case tracking-normal text-[var(--color-text-muted)]', className)}
      {...props}
    />
  );
}

export interface FieldProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
}

/**
 * Wrapping `<label>` so a click on the caption focuses the control, matching
 * the old hand-written `<label className="flex flex-col">` pattern.
 */
export const Field = forwardRef<HTMLLabelElement, FieldProps>(
  ({ label, hint, error, className, children, ...props }, ref) => (
    <label ref={ref} className={cn('flex flex-col', className)} {...props}>
      <Label asChild>
        <span>
          {label}
          {hint != null && <Hint>{hint}</Hint>}
        </span>
      </Label>
      {children}
      {error != null && error !== '' && (
        <span className="mt-1 font-mono text-[10.5px] text-[var(--color-error)]">{error}</span>
      )}
    </label>
  ),
);
Field.displayName = 'Field';

export { labelClass };
