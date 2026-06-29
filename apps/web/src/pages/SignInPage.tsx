import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm, type UseFormSetError } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuthConfig } from '../api/auth-config.js';
import { signIn } from '../lib/auth-client.js';
import { FormField } from '../components/common/FormField.js';
import { OAuthButton } from '../components/common/OAuthButton.js';
import { useClearFormError } from '../hooks/use-clear-form-error.js';
import { Button } from '../components/ui/button.js';

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
  const oauthError = params.get('error');

  const onSubmit = form.handleSubmit(async (values) => {
    await submitSignIn(values, {
      signInEmail: signIn.email,
      setError: form.setError,
      onSuccess: () => navigate(safeNext, { replace: true }),
    });
  });

  // Clear stale root error when the user edits any field.
  useClearFormError(form);

  const rootError = form.formState.errors.root?.message;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1
          className="text-heading font-semibold leading-none tracking-tight text-[var(--color-text)]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Sign in<em className="text-[var(--color-claude-mark)] not-italic">.</em>
        </h1>
        <p className="font-mono text-caption text-[var(--color-text-2)]">
          Welcome back to Conduit.
        </p>
      </div>

      {oauthError && (
        <div role="alert" className="font-mono text-small text-[var(--color-error)]">
          {oauthError.includes('invitation') ? 'Registration is by invitation only.' : 'Authentication failed. Please try again.'}
        </div>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormField
          label="Email"
          error={form.formState.errors.email?.message}
          inputProps={{
            type: 'email',
            autoComplete: 'email',
            autoFocus: true,
            ...form.register('email'),
          }}
        />
        <FormField
          label="Password"
          error={form.formState.errors.password?.message}
          inputProps={{
            type: 'password',
            autoComplete: 'current-password',
            ...form.register('password'),
          }}
        />

        {rootError && (
          <div role="alert" className="font-mono text-small text-[var(--color-error)]">
            {rootError}
          </div>
        )}

        <Button
          type="submit"
          variant="primary"
          className="justify-center"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>

        <div className="flex items-center justify-between font-mono text-small">
          <Link to="/forgot-password" className="text-[var(--color-text-2)] hover:text-[var(--color-text)]">
            Forgot password?
          </Link>
          <Link
            to={`/sign-up${next ? `?next=${encodeURIComponent(next)}` : ''}`}
            className="text-[var(--color-text-2)] hover:text-[var(--color-text)]"
          >
            {inviteOnly ? 'Have an invitation?' : 'Create account'}
          </Link>
        </div>
      </form>

      {(showGithub || showGitlab) && (
        <>
          <Divider />
          {showGithub && <OAuthButton provider="github" label="Continue with GitHub" callbackURL={safeNext} errorCallbackURL="/sign-in" />}
          {showGitlab && <OAuthButton provider="gitlab" label="Continue with GitLab" callbackURL={safeNext} errorCallbackURL="/sign-in" />}
        </>
      )}
    </div>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-[var(--color-divider)]" />
      <span className="font-mono text-caption uppercase tracking-wider text-[var(--color-text-muted)]">
        or
      </span>
      <div className="h-px flex-1 bg-[var(--color-divider)]" />
    </div>
  );
}
