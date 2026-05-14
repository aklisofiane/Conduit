# Auth UI smoke

Locks the browser-side flow that `RequireAuth`, `RedirectIfAuthed`, and
`UserMenuPill` depend on. Drive via Playwright MCP against the dev stack
(`npm run infra:up` + `npm run dev`).

## Setup

- API at `http://localhost:3000`, web at `http://localhost:5173`.
- Use a fresh email per run (e.g. `smoke-${date}@conduit.test`).
- Password: `smoke-password-123`.

## Walkthrough

1. Navigate to `http://localhost:5173/`.
   - Expect: redirected to `/sign-in?next=%2F`. The "Sign in." heading and
     "Welcome back to Conduit." subtitle are visible.

2. Click "Create account" in the sign-in card.
   - Expect: URL becomes `/sign-up`. The Name + Email + Password fields
     are visible.

3. Fill the sign-up form with the fresh email above and submit.
   - Expect: redirect to `/`. The home page renders the `Workflows` heading.
     The user-menu pill on the right of the top bar shows the name (or email)
     and a status dot.

4. Click the user-menu pill.
   - Expect: a popover opens with the name + email header, an "Account
     settings" item, and a "Sign out" item.

5. Click "Account settings".
   - Expect: URL becomes `/account`. The "Account." heading renders, and the
     Profile section shows the name + email entered at sign-up.

6. Click the user-menu pill again, then click "Sign out".
   - Expect: redirect to `/sign-in`. The user-menu pill is gone.

7. Manually navigate to `http://localhost:5173/account`.
   - Expect: redirected to `/sign-in?next=%2Faccount`.

## Notes

- "services healthy" pill must NOT appear anywhere — the default actions
  slot is the user-menu pill now. Pages that override the slot (canvas,
  run-detail) are exempt.
- The forgot-password flow is intentionally a no-op end-to-end until email
  transport ships; a successful submit shows the confirmation banner but
  no email is sent.
