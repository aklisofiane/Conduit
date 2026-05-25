import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm, type UseFormSetError } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuthConfig } from '../api/auth-config.js';
import { signIn } from '../lib/auth-client.js';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password required'),
});

export type SignInValues = z.infer<typeof schema>;

interface SignInDeps {
  signInEmail: typeof signIn.email;
  setError: UseFormSetError<SignInValues>;
  onSuccess: () => void;
}

/**
 * Pure submit helper. Exported so unit tests can drive happy path + the
 * server-error → `setError` branch without rendering the form.
 */
export async function submitSignIn(values: SignInValues, deps: SignInDeps): Promise<void> {
  const res = await deps.signInEmail({ email: values.email, password: values.password });
  if (res.error) {
    deps.setError('root', {
      type: 'server',
      message: res.error.message ?? 'Sign-in failed',
    });
    return;
  }
  deps.onSuccess();
}

export function SignInPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data: authConfig } = useAuthConfig();
  const oauthProviders = authConfig?.oauthProviders ?? [];
  const showGithub = oauthProviders.includes('github');
  const showGitlab = oauthProviders.includes('gitlab');
  const inviteOnly = authConfig?.registrationMode === 'invite-only';

  const form = useForm<SignInValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const next = params.get('next');
  const safeNext = next && next.startsWith('/') ? next : '/';

  const onSubmit = form.handleSubmit(async (values) => {
    await submitSignIn(values, {
      signInEmail: signIn.email,
      setError: form.setError,
      onSuccess: () => navigate(safeNext, { replace: true }),
    });
  });

  // Clear stale root error when the user edits any field.
  useEffect(() => {
    const sub = form.watch(() => {
      if (form.formState.errors.root) form.clearErrors('root');
    });
    return () => sub.unsubscribe();
  }, [form]);

  const rootError = form.formState.errors.root?.message;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1
          className="text-[26px] font-semibold leading-none tracking-tight text-[var(--color-text)]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Sign in<em className="text-[var(--color-claude)] not-italic">.</em>
        </h1>
        <p className="font-mono text-[11.5px] text-[var(--color-text-2)]">
          Welcome back to Conduit.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field
          label="Email"
          error={form.formState.errors.email?.message}
          inputProps={{
            type: 'email',
            autoComplete: 'email',
            autoFocus: true,
            ...form.register('email'),
          }}
        />
        <Field
          label="Password"
          error={form.formState.errors.password?.message}
          inputProps={{
            type: 'password',
            autoComplete: 'current-password',
            ...form.register('password'),
          }}
        />

        {rootError && (
          <div role="alert" className="font-mono text-[11px] text-[var(--color-error)]">
            {rootError}
          </div>
        )}

        <button
          type="submit"
          className="btn primary justify-center"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>

        <div className={`flex font-mono text-[11px] ${inviteOnly ? 'justify-start' : 'items-center justify-between'}`}>
          <Link to="/forgot-password" className="text-[var(--color-text-2)] hover:text-[var(--color-text)]">
            Forgot password?
          </Link>
          {!inviteOnly && (
            <Link
              to={`/sign-up${next ? `?next=${encodeURIComponent(next)}` : ''}`}
              className="text-[var(--color-text-2)] hover:text-[var(--color-text)]"
            >
              Create account
            </Link>
          )}
        </div>
      </form>

      {(showGithub || showGitlab) && (
        <>
          <Divider />
          {showGithub && <OAuthButton provider="github" label="Continue with GitHub" callbackURL={safeNext} />}
          {showGitlab && <OAuthButton provider="gitlab" label="Continue with GitLab" callbackURL={safeNext} />}
        </>
      )}
    </div>
  );
}

function Field({
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

function Divider() {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-[var(--color-divider)]" />
      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
        or
      </span>
      <div className="h-px flex-1 bg-[var(--color-divider)]" />
    </div>
  );
}

function OAuthButton({ provider, label, callbackURL }: { provider: string; label: string; callbackURL: string }) {
  const handleClick = async () => {
    // Relative callbackURLs resolve against the API origin, not the SPA.
    await signIn.social({
      provider: provider as 'github',
      callbackURL: `${window.location.origin}${callbackURL}`,
    });
  };
  return (
    <button type="button" className="btn justify-center" onClick={handleClick}>
      {label}
    </button>
  );
}
