import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm, type UseFormSetError } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuthConfig } from '../api/auth-config.js';
import { signUp } from '../lib/auth-client.js';
import { FormField } from '../components/common/FormField.js';
import { OAuthButton } from '../components/common/OAuthButton.js';
import { useClearFormError } from '../hooks/use-clear-form-error.js';
import { Button } from '../components/ui/button.js';

const schema = z.object({
  name: z.string().min(1, 'Name required').max(120),
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'At least 8 characters'),
});

export type SignUpValues = z.infer<typeof schema>;

interface SignUpDeps {
  signUpEmail: typeof signUp.email;
  setError: UseFormSetError<SignUpValues>;
  onSuccess: () => void;
}

export async function submitSignUp(values: SignUpValues, deps: SignUpDeps): Promise<void> {
  const res = await deps.signUpEmail({
    email: values.email,
    password: values.password,
    name: values.name,
  });
  if (res.error) {
    deps.setError('root', {
      type: 'server',
      message: res.error.message ?? 'Sign-up failed',
    });
    return;
  }
  deps.onSuccess();
}

export function SignUpPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data: authConfig } = useAuthConfig();
  const oauthProviders = authConfig?.oauthProviders ?? [];
  const showGithub = oauthProviders.includes('github');
  const showGitlab = oauthProviders.includes('gitlab');
  const inviteOnly = authConfig?.registrationMode === 'invite-only';

  const form = useForm<SignUpValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const next = params.get('next');
  const safeNext = next && next.startsWith('/') ? next : '/';

  const onSubmit = form.handleSubmit(async (values) => {
    await submitSignUp(values, {
      signUpEmail: signUp.email,
      setError: form.setError,
      onSuccess: () => navigate('/', { replace: true }),
    });
  });

  useClearFormError(form);

  const rootError = form.formState.errors.root?.message;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1
          className="text-[26px] font-semibold leading-none tracking-tight text-[var(--color-text)]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Create account<em className="text-[var(--color-claude-mark)] not-italic">.</em>
        </h1>
        <p className="font-mono text-[11.5px] text-[var(--color-text-2)]">
          {inviteOnly ? 'Registration is by invitation only.' : 'Spin up workflows in minutes.'}
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormField
          label="Name"
          error={form.formState.errors.name?.message}
          inputProps={{
            type: 'text',
            autoComplete: 'name',
            autoFocus: true,
            ...form.register('name'),
          }}
        />
        <FormField
          label="Email"
          error={form.formState.errors.email?.message}
          inputProps={{
            type: 'email',
            autoComplete: 'email',
            ...form.register('email'),
          }}
        />
        <FormField
          label="Password"
          error={form.formState.errors.password?.message}
          inputProps={{
            type: 'password',
            autoComplete: 'new-password',
            ...form.register('password'),
          }}
        />

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
          {form.formState.isSubmitting ? 'Creating account…' : 'Create account'}
        </Button>

        <div className="flex justify-end font-mono text-[11px]">
          <Link
            to={`/sign-in${next ? `?next=${encodeURIComponent(next)}` : ''}`}
            className="text-[var(--color-text-2)] hover:text-[var(--color-text)]"
          >
            Already have an account?
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
      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
        or
      </span>
      <div className="h-px flex-1 bg-[var(--color-divider)]" />
    </div>
  );
}
