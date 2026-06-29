import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm, type UseFormSetError } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { requestPasswordReset } from '../lib/auth-client.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { Label } from '../components/ui/field.js';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
});

export type ForgotPasswordValues = z.infer<typeof schema>;

interface ForgotDeps {
  request: typeof requestPasswordReset;
  setError: UseFormSetError<ForgotPasswordValues>;
  onSuccess: () => void;
}

export async function submitForgotPassword(
  values: ForgotPasswordValues,
  deps: ForgotDeps,
): Promise<void> {
  const res = await deps.request({ email: values.email, redirectTo: '/reset-password' });
  if (res.error) {
    deps.setError('root', {
      type: 'server',
      message: res.error.message ?? 'Could not send reset email',
    });
    return;
  }
  deps.onSuccess();
}

/**
 * Email transport is intentionally OFF in v1 (see SPEC_PLAN cross-cutting
 * note) — Better Auth's `forgetPassword` succeeds with a no-op send hook
 * when none is configured, so this page is functional today: it accepts
 * the email and shows a confirmation. The actual email lands the day the
 * transport ships.
 */
export function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false);

  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    await submitForgotPassword(values, {
      request: requestPasswordReset,
      setError: form.setError,
      onSuccess: () => setSubmitted(true),
    });
  });

  const rootError = form.formState.errors.root?.message;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1
          className="text-[26px] font-semibold leading-none tracking-tight text-[var(--color-text)]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Reset password<em className="text-[var(--color-claude-mark)] not-italic">.</em>
        </h1>
        <p className="font-mono text-[11.5px] text-[var(--color-text-2)]">
          Enter your email and we'll send you a reset link.
        </p>
      </div>

      {submitted ? (
        <div className="flex flex-col gap-3">
          <div className="rounded-[var(--radius)] border border-[var(--color-divider)] bg-[var(--color-pill-bg)] px-3 py-3 font-mono text-[11.5px] text-[var(--color-text-2)]">
            If an account matches that email, a reset link is on its way.
          </div>
          <Link
            to="/sign-in"
            className="font-mono text-[11px] text-[var(--color-text-2)] hover:text-[var(--color-text)]"
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <label className="flex flex-col">
            <Label asChild><span>Email</span></Label>
            <Input
              type="email"
              autoComplete="email"
              autoFocus
              {...form.register('email')}
            />
            {form.formState.errors.email?.message && (
              <span className="mt-1 font-mono text-[10.5px] text-[var(--color-error)]">
                {form.formState.errors.email.message}
              </span>
            )}
          </label>

          {rootError && (
            <div role="alert" className="font-mono text-[11px] text-[var(--color-error)]">
              {rootError}
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            className="justify-center"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? 'Sending…' : 'Send reset link'}
          </Button>

          <div className="flex justify-start font-mono text-[11px]">
            <Link to="/sign-in" className="text-[var(--color-text-2)] hover:text-[var(--color-text)]">
              Back to sign in
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
