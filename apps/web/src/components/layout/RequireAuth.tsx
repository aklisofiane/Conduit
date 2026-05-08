import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSession } from '../../lib/auth-client.js';

interface RequireAuthProps {
  children: ReactNode;
}

/**
 * Session gate for authenticated routes. While the session resolves we show
 * a small loader rather than flashing the protected UI; once resolved we
 * either render `children` or redirect to `/sign-in?next=<current-path>`.
 * The `?next` param is consumed by `SignInPage` / `SignUpPage` so the user
 * lands back where they tried to go after authenticating.
 */
export function RequireAuth({ children }: RequireAuthProps) {
  const { data, isPending } = useSession();
  const location = useLocation();

  if (isPending) return <SessionLoader />;
  if (!data) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/sign-in?next=${next}`} replace />;
  }
  return <>{children}</>;
}

function SessionLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)]">
      <div className="font-mono text-[12px] text-[var(--color-text-muted)]">Loading…</div>
    </div>
  );
}
