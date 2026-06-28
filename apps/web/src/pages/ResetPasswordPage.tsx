import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm, type UseFormSetError } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { resetPassword } from '../lib/auth-client.js';
import { Button } from '../components/ui/button.js';

const schema = z.object({
  password: z.string().min(8, 'At least 8 characters'),
});

export type ResetPasswordValues = z.infer<typeof schema>;

interface ResetDeps {
  reset: typeof resetPassword;
  setError: UseFormSetError<ResetPasswordValues>;
  onSuccess: () => void;
  token: string;
}

export async function submitResetPassword(
  values: ResetPasswordValues,
  deps: ResetDeps,
): Promise<void> {
  const res = await deps.reset({ token: deps.token, newPassword: values.password });
  if (res.error) {
    deps.setError('root', {
      type: 'server',
      message: res.error.message ?? 'Could not reset password',
    });
    return;
  }
  deps.onSuccess();
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = useState(false);

  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    await submitResetPassword(values, {
      reset: resetPassword,
      setError: form.setError,
      onSuccess: () => {
        setDone(true);
        setTimeout(() => navigate('/sign-in', { replace: true }), 800);
      },
      token,
    });
  });

  const rootError = form.formState.errors.root?.message;

  if (!token) {
    return (
      <div className="flex flex-col gap-4">
        <h1
          className="text-[26px] font-semibold leading-none tracking-tight text-[var(--color-text)]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Invalid link<em className="text-[var(--color-claude)] not-italic">.</em>
        </h1>
        <p className="font-mono text-[11.5px] text-[var(--color-text-2)]">
          This reset link is missing its token.{' '}
          <Link to="/forgot-password" className="underline">
            Request a new one
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1
          className="text-[26px] font-semibold leading-none tracking-tight text-[var(--color-text)]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          New password<em className="text-[var(--color-claude)] not-italic">.</em>
        </h1>
        <p className="font-mono text-[11.5px] text-[var(--color-text-2)]">
          Choose a strong password — at least 8 characters.
        </p>
      </div>

      {done ? (
        <div className="rounded-[var(--radius)] border border-[var(--color-divider)] bg-[var(--color-pill-bg)] px-3 py-3 font-mono text-[11.5px] text-[var(--color-text-2)]">
          Password updated. Redirecting to sign-in…
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <label className="flex flex-col">
            <span className="field-label">New password</span>
            <input
              className="field-input"
              type="password"
              autoComplete="new-password"
              autoFocus
              {...form.register('password')}
            />
            {form.formState.errors.password?.message && (
              <span className="mt-1 font-mono text-[10.5px] text-[var(--color-error)]">
                {form.formState.errors.password.message}
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
            {form.formState.isSubmitting ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      )}
    </div>
  );
}
