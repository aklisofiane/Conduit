import type { Auth } from './auth.config';

type SessionResponse = Awaited<ReturnType<Auth['api']['getSession']>>;
type NonNullSession = NonNullable<SessionResponse>;

export type AuthUser = NonNullSession['user'];
export type AuthSession = NonNullSession['session'];

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      session?: AuthSession;
    }
  }
}
