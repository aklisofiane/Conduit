import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, type UseFormSetError } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { authClient, signOut, useSession } from '../lib/auth-client.js';
import { FormField } from '../components/common/FormField.js';
import { Button } from '../components/ui/button.js';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group.js';
import { useTheme } from '../hooks/use-theme.js';
import type { ThemePref } from '../lib/theme.js';

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password required'),
    newPassword: z.string().min(8, 'At least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });

export type ChangePasswordValues = z.infer<typeof passwordSchema>;

interface ChangePasswordDeps {
  changePassword: typeof authClient.changePassword;
  setError: UseFormSetError<ChangePasswordValues>;
  onSuccess: () => void;
}

export async function submitChangePassword(
  values: ChangePasswordValues,
  deps: ChangePasswordDeps,
): Promise<void> {
  const res = await deps.changePassword({
    currentPassword: values.currentPassword,
    newPassword: values.newPassword,
  });
  if (res.error) {
    deps.setError('root', {
      type: 'server',
      message: res.error.message ?? 'Could not change password',
    });
    return;
  }
  deps.onSuccess();
}

/**
 * `/account` — basic identity readout + change-password + sign-out. The
 * `org-on-signup-and-switching` sub-feature extends this with members and
 * invitations management; for now the page is intentionally minimal so it
 * renders cleanly the moment the route lands.
 */
export function AccountSettingsPage() {
  const { data } = useSession();
  const user = data?.user;

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-6 px-6 pb-16 pt-10">
      <h1
        className="text-display font-semibold leading-none tracking-tight text-[var(--color-text)]"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        Account
      </h1>
      <p className="font-mono text-small text-[var(--color-text-2)]">
        Your profile and password. Organization-level settings live elsewhere.
      </p>

      <section className="rounded-lg border border-[var(--color-divider)] bg-[var(--color-bg-panel)]">
        <header className="border-b border-[var(--color-divider)] px-4 py-3">
          <h2 className="font-mono text-base font-semibold">Profile</h2>
        </header>
        <dl className="grid grid-cols-[140px_1fr] items-center gap-y-3 px-4 py-4">
          <dt className="font-mono text-caption uppercase tracking-wide text-[var(--color-text-muted)]">
            Name
          </dt>
          <dd className="font-mono text-small text-[var(--color-text)]">
            {user?.name?.trim() || '—'}
          </dd>
          <dt className="font-mono text-caption uppercase tracking-wide text-[var(--color-text-muted)]">
            Email
          </dt>
          <dd className="font-mono text-small text-[var(--color-text)]">{user?.email ?? '—'}</dd>
        </dl>
      </section>

      <AppearanceSection />

      <ChangePasswordSection />

      <SignOutSection />
    </div>
  );
}

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function AppearanceSection() {
  const { pref, setPref } = useTheme();

  return (
    <section className="rounded-lg border border-[var(--color-divider)] bg-[var(--color-bg-panel)]">
      <header className="border-b border-[var(--color-divider)] px-4 py-3">
        <h2 className="font-mono text-base font-semibold">Appearance</h2>
      </header>
      <div className="flex items-center justify-between gap-4 px-4 py-4">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-small text-[var(--color-text)]">Theme</span>
          <span className="font-mono text-small text-[var(--color-text-muted)]">
            “System” follows your operating system setting.
          </span>
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          value={pref}
          onValueChange={(v) => {
            if (v) setPref(v as ThemePref);
          }}
          aria-label="Theme preference"
        >
          {THEME_OPTIONS.map((opt) => (
            <ToggleGroupItem key={opt.value} value={opt.value}>
              {opt.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </section>
  );
}

function ChangePasswordSection() {
  const [done, setDone] = useState(false);

  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    await submitChangePassword(values, {
      changePassword: authClient.changePassword,
      setError: form.setError,
      onSuccess: () => {
        setDone(true);
        form.reset();
        setTimeout(() => setDone(false), 3000);
      },
    });
  });

  const rootError = form.formState.errors.root?.message;

  return (
    <section className="rounded-lg border border-[var(--color-divider)] bg-[var(--color-bg-panel)]">
      <header className="border-b border-[var(--color-divider)] px-4 py-3">
        <h2 className="font-mono text-base font-semibold">Change password</h2>
      </header>
      <form onSubmit={onSubmit} className="flex flex-col gap-3 px-4 py-4" noValidate>
        <FormField
          label="Current password"
          error={form.formState.errors.currentPassword?.message}
          inputProps={{
            type: 'password',
            autoComplete: 'current-password',
            ...form.register('currentPassword'),
          }}
        />
        <FormField
          label="New password"
          error={form.formState.errors.newPassword?.message}
          inputProps={{
            type: 'password',
            autoComplete: 'new-password',
            ...form.register('newPassword'),
          }}
        />
        <FormField
          label="Confirm new password"
          error={form.formState.errors.confirmPassword?.message}
          inputProps={{
            type: 'password',
            autoComplete: 'new-password',
            ...form.register('confirmPassword'),
          }}
        />

        {rootError && (
          <div role="alert" className="font-mono text-small text-[var(--color-error)]">
            {rootError}
          </div>
        )}
        {done && (
          <div className="font-mono text-small text-[var(--color-success)]">
            Password updated.
          </div>
        )}

        <div className="flex">
          <Button
            type="submit"
            variant="primary"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? 'Updating…' : 'Update password'}
          </Button>
        </div>
      </form>
    </section>
  );
}

function SignOutSection() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const handleSignOut = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await signOut();
    } finally {
      setBusy(false);
      navigate('/sign-in', { replace: true });
    }
  };

  return (
    <section className="rounded-lg border border-[var(--color-divider)] bg-[var(--color-bg-panel)]">
      <header className="border-b border-[var(--color-divider)] px-4 py-3">
        <h2 className="font-mono text-base font-semibold">Sign out</h2>
      </header>
      <div className="flex items-center justify-between gap-4 px-4 py-4">
        <p className="font-mono text-caption text-[var(--color-text-2)]">
          End this browser session.
        </p>
        <Button onClick={handleSignOut} disabled={busy}>
          {busy ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </section>
  );
}
