import { Field } from '../ui/field.js';
import { Input } from '../ui/input.js';

/**
 * Label + input + error trio shared by the auth and account forms. Now a thin
 * composition over the `ui/` form primitives; `inputProps` is spread onto the
 * `<Input>` so callers pass `type`, `autoComplete`, and react-hook-form's
 * `register()` output through it.
 */
export function FormField({
  label,
  error,
  inputProps,
}: {
  label: string;
  error?: string;
  inputProps: React.InputHTMLAttributes<HTMLInputElement>;
}) {
  return (
    <Field label={label} error={error}>
      <Input {...inputProps} />
    </Field>
  );
}
