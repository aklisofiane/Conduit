# Web auth UI

Browser-side authentication surface for Conduit. Owns the unauthenticated route shell (sign-in / sign-up / forgot-password / reset-password), the authenticated `/account` page, the `RequireAuth` boundary inside `AppLayout`, and the `UserMenuPill` that anchors the top bar's actions slot once a user is signed in. Pairs with the API-side Better Auth mount described in [auth-integration.md](./auth-integration.md) and the partitioning shim in [tenant-partitioning.md](./tenant-partitioning.md) (cross-org enforcement in [authorization-enforcement.md](./authorization-enforcement.md)) — this doc is the *web* side only.

## Surface

| File | Role |
|---|---|
| `apps/web/src/lib/auth-client.ts` | Single Better Auth React client (`createAuthClient({ baseURL: apiBaseUrl })`); exports `signIn`, `signUp`, `signOut`, `useSession`, `requestPasswordReset`, `resetPassword`, plus the account-linking trio `linkSocial`, `listAccounts`, `unlinkAccount` (see [oauth-account-linking.md](./oauth-account-linking.md)). The full client (`authClient`) is also exported for non-destructured methods like `authClient.changePassword`. |
| `apps/web/src/api/auth-config.ts` | TanStack Query hook (`useAuthConfig`) over `GET /api/auth-config` — `{ deployment: 'local' \| 'hosted', oauthProviders: string[] }` — `'github'` and/or `'gitlab'`, each present only when its env pair is set. `staleTime: Infinity` — config doesn't change for the page lifetime. |
| `apps/web/src/components/layout/AuthLayout.tsx` | Unauthenticated shell. Centered card surface, brand mark, no `TopChrome`. Pages render via `<Outlet />`. |
| `apps/web/src/components/layout/RequireAuth.tsx` | Wraps `AppLayout`. Loader while `useSession()` resolves; redirects to `/sign-in?next=<encoded-current-path>` when `data === null`. |
| `apps/web/src/components/layout/RedirectIfAuthed.tsx` | Wraps the auth-route branch. Sends a logged-in user to `?next` (path-prefixed) or `/` instead of letting them see the form. Renders children while pending so already-cookied users still see the form transiently — never blocks. |
| `apps/web/src/components/layout/UserMenuPill.tsx` | Default `actionsSlot` content for `TopChrome`. Pill (status dot + name/email truncated to 180px + chevron) anchors a portal-rendered popover with the name + email header, an Account-settings item, and a Sign-out item. Click-outside + Escape close it. |
| `apps/web/src/pages/SignInPage.tsx` | Email + password + "Forgot password?" link + an OAuth button per advertised provider. Honors `?next`. |
| `apps/web/src/pages/SignUpPage.tsx` | Name + email + password + the same OAuth buttons (same gate). Always navigates to `/` on success — `?next` is not honored on signup by design. |
| `apps/web/src/pages/ForgotPasswordPage.tsx` | Email field calls `requestPasswordReset({ email, redirectTo: '/reset-password' })`. End-to-end no-op until email transport ships — page exists so the route works the day email lands. |
| `apps/web/src/pages/ResetPasswordPage.tsx` | Reads `?token=<x>`. Functional today given a valid token. Renders an "invalid link" state when no token is present. |
| `apps/web/src/pages/AccountSettingsPage.tsx` | `/account`, inside `AppLayout`. Profile readout (name, email), a **Linked accounts** panel (link/unlink per OAuth provider — see [oauth-account-linking.md](./oauth-account-linking.md)), change-password form (current + new + confirm with `refine`-based confirm match), and a Sign-out section. Visual shape mirrors `CredentialsPage` (centered `max-w-[900px]`, serif heading with the `--color-claude-mark` accent dot, mono helper text). |

## Routing

`apps/web/src/routes/router.tsx` splits into two top-level branches.

```
RedirectIfAuthed → AuthLayout
  /sign-in
  /sign-up
  /forgot-password
  /reset-password

RequireAuth → AppLayout (TopChrome + <Outlet />)
  /                       HomePage
  /workflows/:id          CanvasPage
  /workflows/:id/...      (existing)
  /runs/:runId            RunDetailPage
  /credentials            CredentialsPage
  /connections            ConnectionsPage
  /account                AccountSettingsPage
```

`/account` replaces the placeholder `/settings` row from earlier drafts of [FRONTEND.md](../FRONTEND.md). Org-level settings remain out of scope here — `org-on-signup-and-switching` adds them later.

## Session lifecycle

```
mount RequireAuth
  └─ useSession()
       isPending=true   → render <SessionLoader/>
       data===null      → <Navigate to="/sign-in?next=…" />
       data!==null      → render protected children
```

`useSession()` returns `{ data, isPending, isRefetching, error, refetch }` from Better Auth's nanostores-backed hook. `data.user.{id,email,name,image}` and `data.session.{id,...}` when authenticated; `data === null` when not. The hook subscribes to a single shared atom — multiple `RequireAuth` / `UserMenuPill` mounts share state and a single in-flight request.

`signOut()` clears the session cookie and the atom; the `UserMenuPill` handler awaits it before navigating to `/sign-in` so a stale session doesn't bounce the user back through `RedirectIfAuthed`.

## Cookie wiring

The session cookie is set by Better Auth on sign-up / sign-in responses. `apps/web/src/api/client.ts` already sets `credentials: 'include'` on every request (owned by `better-auth-integration`, off-limits here per the spec), and Better Auth's underlying `BetterFetch` does the same — so both the typed `api` wrapper *and* the auth client carry the cookie automatically. There is no `Authorization` header anywhere on the web side anymore; the prior `X-API-Key` was deleted by the same earlier sub-feature.

## TopChrome `actionsSlot` pattern

`apps/web/src/state/topbar-slots.ts` exposes `useTopbarSlotsStore` and a `useTopbarSlots()` hook. Pages that want to publish into the topbar (canvas, run detail) call the hook with their own `<center>` and `<actions>` ReactNodes; the store identity-checks before assigning and splits per-slot effects so an unchanged slot doesn't churn.

When `actionsSlot === null`, `TopChrome` now renders `<UserMenuPill />` as the default — replacing the previous "services healthy" pill, which has been removed. Pages that already override `actionsSlot` (canvas, run detail) keep their override unchanged; the user menu only appears on routes that don't publish their own actions.

## Forms

All five pages use `react-hook-form` + `@hookform/resolvers/zod`. Schemas are defined inline at the top of each page file. Each page exports a pure `submit*` helper (`submitSignIn`, `submitSignUp`, `submitForgotPassword`, `submitResetPassword`, `submitChangePassword`) that takes `(values, deps)` where `deps` carries the auth-client method, the RHF `setError`, and an `onSuccess` callback. The page's `handleSubmit` wires RHF + `useNavigate` into that helper.

This split exists for one reason: the helpers are unit-testable as plain `.test.ts` files (no jsdom, no testing-library — neither is present in the repo). Tests in `apps/web/src/pages/*.test.ts` cover happy-path submit + 400-error → `setError('root', …)` for each form. The form's submitting state is RHF's `formState.isSubmitting`; the surfaced error is `formState.errors.root?.message`.

Server errors arrive as `{ data: null, error: { status, message } }` — not as thrown exceptions. Every helper short-circuits on `res.error` and routes the message into `setError('root', …)`; tests pin both shapes.

## OAuth availability

`useAuthConfig()` fetches `/api/auth-config` once at first use and caches forever (per page lifetime). `oauthProviders.includes(<provider>)` is the gate for that provider's button — on SignIn / SignUp, and equally on the linking surfaces described in [oauth-account-linking.md](./oauth-account-linking.md). Server-side, a provider appears iff its `_CLIENT_ID` + `_CLIENT_SECRET` pair is set — see [auth.config.ts](../../apps/api/src/auth/auth.config.ts). Runtime over build-time so a config flip doesn't require rebuilding the web bundle.

Each provider button calls `signIn.social({ provider, callbackURL })`. `callbackURL` is the resolved `?next` value (path-prefixed only — bare `/` if `next` doesn't start with `/`).

## Better Auth client API delta (1.6.9)

The umbrella spec called for a `forgetPassword` method, but Better Auth 1.6.9 ships the password-reset endpoint as **`POST /api/auth/request-password-reset`** and exposes it on the React client as **`authClient.requestPasswordReset({ email, redirectTo })`**. There is no `forgetPassword` method on this version of the React client. Future contributors extending the auth surface should follow the actual library shape, not the original spec wording.

Method shapes used (all return `{ data, error }`; `error.message` is what we surface):

| Method | Body |
|---|---|
| `signIn.email` | `{ email, password }` |
| `signIn.social` | `{ provider, callbackURL }` |
| `signUp.email` | `{ email, password, name }` |
| `signOut` | `()` (no args) |
| `requestPasswordReset` | `{ email, redirectTo }` |
| `resetPassword` | `{ token, newPassword }` |
| `authClient.changePassword` | `{ currentPassword, newPassword }` |
| `useSession` | `() → { data, isPending, isRefetching, error, refetch }` |

The org-plugin client surface (`authClient.organization.*`) is auto-mounted because the API enables `organization()` in `auth.config.ts` — `org-on-signup-and-switching` consumes it from the same `authClient` instance, no separate client needed.

## Tests

| Location | What it locks |
|---|---|
| `apps/web/src/pages/*.test.ts` (×5) | Each `submit*` helper: happy-path call shape + 400-error → `setError('root')`. Auth client mocked with `vi.fn()` returning `{ data, error }` shapes. |
| `test/e2e/auth-cookie-flow.test.ts` | Server-side cookie round-trip: sign-up sets a cookie → `get-session` resolves the user → `sign-out` clears it → `get-session` returns `null`. Plus a `GET /api/auth-config` smoke. |
| `test/smoke/auth.smoke.md` | Browser-driven walkthrough for Playwright MCP (matches the repo's `test/smoke/*.smoke.md` convention from [VALIDATION.md](../VALIDATION.md)). Locks regressions on `RequireAuth`, `RedirectIfAuthed`, and the `UserMenuPill` flow. |

The repo doesn't ship Playwright as a dependency — the team-lead spec says "Playwright E2E spec under `test/e2e/`" but there is no Playwright runtime to host one. The intent (one regression-locking spec for the flow) is split between the cookie-flow vitest above and the smoke markdown.

## Out of scope

- Org switcher, members management, invitations management — `org-on-signup-and-switching` extends the `UserMenuPill` popover. The current popover layout (header block + items list) is shaped to make slotting an Organizations section in straightforward.
- Socket.IO `withCredentials: true` on the runs gateway — `authorization-enforcement` adds it; `apps/web/src/hooks/use-run-updates.ts` is not touched here.
- Email transport. `requestPasswordReset` succeeds end-to-end when the server has no transport configured; the page intentionally shows a confirmation banner regardless so the UI works the day the transport ships.
- MFA, passkeys, magic links.
