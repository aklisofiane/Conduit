import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSession } from '../../lib/auth-client.js';

interface RedirectIfAuthedProps {
  children: ReactNode;
}

/**
 * Inverse of `RequireAuth`. If a logged-in user navigates to one of the
 * auth pages, send them home (or to the `?next` value if present). While
 * the session is still resolving we render `children` — the auth pages
 * are safe to show, and waiting would block sign-in for users who arrive
 * already-cookied.
 */
export function RedirectIfAuthed({ children }: RedirectIfAuthedProps) {
  const { data, isPending } = useSession();
  const [params] = useSearchParams();
  const location = useLocation();

  if (!isPending && data) {
    const next = params.get('next');
    const target = next && next.startsWith('/') ? next : '/';
    return <Navigate to={target} replace state={{ from: location }} />;
  }
  return <>{children}</>;
}
