import type { IncomingHttpHeaders } from 'node:http';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from './auth.config';
import type { AuthSession, AuthUser } from './types';

export interface WsAuthResult {
  user: AuthUser;
  session: AuthSession;
}

/**
 * Resolve a Better Auth session from a Socket.IO connection's Node-IM
 * headers. Returns `null` when the request carries no valid session
 * cookie. Mirrors the REST `SessionGuard` so any future gateway can
 * authenticate WS handshakes without duplicating the cookie/headers
 * plumbing.
 */
export async function resolveWsSession(headers: IncomingHttpHeaders): Promise<WsAuthResult | null> {
  const result = await auth.api.getSession({
    headers: fromNodeHeaders(headers),
  });
  if (!result) return null;
  return { user: result.user, session: result.session };
}
