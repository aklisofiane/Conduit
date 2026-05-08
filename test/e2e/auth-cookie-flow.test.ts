import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './harness';

/**
 * Locks the cookie-based auth flow that `RequireAuth`, `RedirectIfAuthed`,
 * and `UserMenuPill` depend on:
 *
 *   sign-up → session cookie set → get-session resolves → sign-out clears
 *   the cookie → get-session reports an unauthenticated state again.
 *
 * The harness already signs up at startup and exposes the captured cookie,
 * but here we drive the full flow against a fresh user against the live
 * `/api/auth/*` routes so we can prove the round-trip the web UI relies on
 * without spinning up a real browser. The matching browser-level walkthrough
 * lives under `test/smoke/auth.smoke.md` for Playwright MCP.
 */

interface AuthCookieData {
  user: { id: string; email: string; name: string };
  session: { id: string };
}

describe('Auth cookie flow (sign-up → get-session → sign-out)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });

  afterAll(async () => {
    await h?.stop();
  });

  it('issues a session cookie on sign-up and clears it on sign-out', async () => {
    const email = `flow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@conduit.test`;
    const password = 'flow-password-123';

    const signUpRes = await fetch(`${h.apiUrl}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'Flow User' }),
    });
    expect(signUpRes.status).toBe(200);

    const setCookies =
      typeof signUpRes.headers.getSetCookie === 'function'
        ? signUpRes.headers.getSetCookie()
        : ([signUpRes.headers.get('set-cookie')].filter(Boolean) as string[]);
    expect(setCookies.length).toBeGreaterThan(0);
    const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');

    // While the cookie is live, get-session resolves with the user.
    const getSessionRes = await fetch(`${h.apiUrl}/api/auth/get-session`, {
      headers: { cookie },
    });
    expect(getSessionRes.status).toBe(200);
    const session = (await getSessionRes.json()) as AuthCookieData | null;
    expect(session?.user.email).toBe(email);

    // Sign out clears the cookie.
    const signOutRes = await fetch(`${h.apiUrl}/api/auth/sign-out`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(signOutRes.ok).toBe(true);

    // After sign-out, the original cookie no longer resolves a session.
    const afterRes = await fetch(`${h.apiUrl}/api/auth/get-session`, {
      headers: { cookie },
    });
    expect(afterRes.status).toBe(200);
    const after = (await afterRes.json()) as AuthCookieData | null;
    expect(after).toBeNull();
  });

  it('returns the public auth-config without a session', async () => {
    const res = await fetch(`${h.apiUrl}/api/auth-config`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deployment: string; oauthProviders: string[] };
    expect(['local', 'hosted']).toContain(body.deployment);
    expect(Array.isArray(body.oauthProviders)).toBe(true);
  });
});
