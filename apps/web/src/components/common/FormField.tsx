/**
 * Label + input + error-span trio shared by the auth and account forms.
 * `inputProps` is spread onto the `<input>` so callers pass `type`,
 * `autoComplete`, and react-hook-form's `register()` output through it.
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
    <label className="flex flex-col">
      <span className="field-label">{label}</span>
      <input className="field-input" {...inputProps} />
      {error && (
        <span className="mt-1 font-mono text-[10.5px] text-[var(--color-error)]">{error}</span>
      )}
    </label>
  );
}
