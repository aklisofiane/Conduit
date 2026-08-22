/**
 * Better Auth's client returns `{ data, error }` rather than throwing, which
 * react-query can't turn into an `isError` state on its own. These helpers
 * normalise that envelope into the throw/return contract every `useQuery` /
 * `useMutation` in `apps/web/src/api` already assumes.
 *
 * `AuthClientError` keeps the server's `code` (e.g.
 * `FAILED_TO_UNLINK_LAST_ACCOUNT`) alongside the message so callers can branch
 * on the machine-readable form instead of string-matching prose.
 */
export interface AuthErrorShape {
  code?: string;
  message?: string;
  status?: number;
}

export class AuthClientError extends Error {
  readonly code?: string;
  readonly status?: number;

  constructor(error: AuthErrorShape, fallback = 'Request failed') {
    super(error.message ?? fallback);
    this.name = 'AuthClientError';
    this.code = error.code;
    this.status = error.status;
  }
}

export function unwrapAuthResult<T>(res: {
  data: T | null;
  error: AuthErrorShape | null;
}): T {
  if (res.error) throw new AuthClientError(res.error);
  if (res.data === null || res.data === undefined) {
    throw new Error('Empty response');
  }
  return res.data;
}

export function unwrapAuthVoid(
  res: { error: AuthErrorShape | null },
  fallback: string,
): void {
  if (res.error) throw new AuthClientError(res.error, fallback);
}
