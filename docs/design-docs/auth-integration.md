# Auth Integration

How Conduit authenticates HTTP requests. The API embeds [Better Auth](https://better-auth.com/) for sign-up / sign-in / session storage, and a Nest guard (`SessionGuard`) replaces the old single-shared-API-key model on every protected route. This doc covers the mount, the guard, the public auth-config endpoint, and how the E2E harness signs in.

Out of scope here:
- Tenant scoping (`orgId` on Conduit models, `@OrgId()` decorator, signup-time shim) — see [tenant-partitioning.md](./tenant-partitioning.md).
- Web login/signup UI — see [web-auth-ui.md](./web-auth-ui.md).
- Socket.IO authentication on `RunsGateway`, the cross-org-404 convention, and the v1 RBAC stance — see [authorization-enforcement.md](./authorization-enforcement.md).
- Rate limits, audit log, abuse signals — handled by `operational-hardening`.

## Module layout

`apps/api/src/auth/` is a peer of `common/`, `redis/`, `temporal/` — same shape as the rest of the API's infra modules.

| File | Role |
|---|---|
| `auth.config.ts` | Configured Better Auth instance + `oauthProviders` list. Exports the `auth` singleton consumed by middleware, guard, and (later) the data-partitioning signup hook. |
| `better-auth.middleware.ts` | Express adapter via `toNodeHandler(auth)`. Handles every `/api/auth/*` route. |
| `session.guard.ts` | Nest `CanActivate` that calls `auth.api.getSession({ headers })`, attaches `req.user` + `req.session`, throws 401 on miss. |
| `auth.controller.ts` | Public `GET /api/auth-config` — surfaces `{ deployment, oauthProviders }` so the web UI knows which buttons to render. |
| `auth.module.ts` | `@Global()` Nest module. Exports `SessionGuard` and the `AUTH` symbol-keyed provider that hands out the `auth` instance. |
| `types.ts` | Side-effect global `Express.Request` augmentation declaring `user` and `session`. |

## Mount order in `main.ts`

Better Auth needs the **raw** request stream — calling `express.json()` first would consume the body and the auth handler would hang on pending requests.

```
app.use('/api/auth', betterAuthMiddleware);   // raw body, no parsing
app.use(express.json({ verify: rawBody }));   // everyone else
app.use(express.urlencoded({ extended: true }));
```

The webhook controller (`POST /api/hooks/:workflowId`) still receives the raw bytes for HMAC via `verify: rawBody` — that flow is unchanged. Both Better Auth and the webhook HMAC-verifier are deliberately positioned around `express.json()` to preserve their respective raw-stream / raw-buffer needs.

## Configuration

`apps/api/src/config.ts`:

| Field | Env | Default | Purpose |
|---|---|---|---|
| `deployment` | `CONDUIT_DEPLOYMENT` | `local` | `local \| hosted`. Drives rate-limit aggressiveness later — does **not** gate which providers exist. |
| `betterAuth.secret` | `BETTER_AUTH_SECRET` | dev fallback | Signs session cookies. Required in prod; rotate to invalidate every session. |
| `betterAuth.baseURL` | `BETTER_AUTH_URL` | `http://localhost:${port}` | Public origin used for OAuth redirect URIs. |
| `betterAuth.githubOAuth` | `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` | undefined | GitHub OAuth surfaces only when **both** halves are set, in either deployment mode. |

When GitHub OAuth is enabled the provider requests `scope: ['repo', 'project', 'read:org']` — the same surface Conduit's workflows need from a manual PAT. Pre-existing OAuth users see GitHub's consent screen again on next sign-in.

`auth.config.ts` wires those into Better Auth with the Prisma adapter, `emailAndPassword: { enabled: true, requireEmailVerification: false }`, `emailVerification.sendOnSignUp: false` (no email transport yet — tracked as a cross-cutting TODO), and the `organization()` plugin. The signup-time shim — `databaseHooks.session.create.before` calls `ensurePersonalOrgFor(userId)` and stamps the returned `activeOrganizationId` onto each new session before the cookie is issued — is **owned by tenant-partitioning** but lives in this same file because it's part of Better Auth config. See [tenant-partitioning.md](./tenant-partitioning.md#signup-time-shim).

In `hosted` mode a second hook, `databaseHooks.user.create.before`, gates registration: a signup whose email is neither seeded (`config.seedEmails`) nor backed by a pending `Invitation` throws `403 'Registration is by invitation only'`. No-op in `local`. See [authentication.md § Invitation gate](./authentication.md#invitation-gate-hosted-only).

`oauthProviders` is computed once at module load: `['github']` when `githubOAuth` is set, `[]` otherwise. The auth controller returns it verbatim so the web client doesn't re-read env.

## Guarded routes

Every non-webhook controller carries `@UseGuards(SessionGuard)`:

```
workflows • runs • credentials • connections • templates •
trigger • mcp • agent-presets • skills
```

`SessionGuard.canActivate`:

1. Pulls `req.headers` and converts via Better Auth's `fromNodeHeaders` (Node `IncomingHttpHeaders` → Web `Headers`).
2. Calls `await auth.api.getSession({ headers })`.
3. Miss → `UnauthorizedException('Authentication required')` → 401.
4. Hit → assigns `req.user = result.user`, `req.session = result.session`, returns true.

`POST /api/hooks/:workflowId` deliberately stays unguarded — the platform doesn't carry a session cookie, and authentication runs through HMAC-SHA256 over the raw body inside `WebhooksService`.

## Public `GET /api/auth-config`

Returns `{ deployment: 'local' | 'hosted', oauthProviders: string[] }`. Not session-guarded — by definition, callers haven't authenticated yet. `web-auth-ui` will read this once at app start to decide whether to render the GitHub button.

## Auth surface (Better Auth)

Mounted under `/api/auth/*`. The endpoints relevant to first-party callers today:

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/auth/sign-up/email` | Body `{ email, password, name }`. Sets `Set-Cookie: better-auth.session_token=…; HttpOnly; SameSite=Lax`. Returns `{ token, user }`. |
| `POST` | `/api/auth/sign-in/email` | Same cookie shape. |
| `POST` | `/api/auth/sign-out` | Clears the session row + cookie. |
| `GET`  | `/api/auth/get-session` | Returns the active `{ user, session }` for the cookie or `null`. |

The `organization` plugin contributes `/api/auth/organization/*` endpoints (create, list, set-active) — they're available now because the plugin is loaded, but Conduit doesn't call them until `data-model-partitioning` adds the signup-time shim and `org-on-signup-and-switching` adds the switcher UI.

## Web client cookie flow

`apps/web/src/api/client.ts` sets `credentials: 'include'` on every fetch — the browser attaches `better-auth.session_token` automatically. The Socket.IO client (`apps/web/src/hooks/use-run-updates.ts`) passes `withCredentials: true` for the same reason. Until `web-auth-ui` ships, there is no UI to obtain that cookie in a browser; the test harness is the only consumer that authenticates today.

## E2E harness signup

`test/e2e/harness.ts` creates one synthetic user per harness instance:

1. `signUpAndCaptureCookie` POSTs `{ email: e2e-${ts}-${rand}@conduit.test, password: 'harness-password-123', name: 'E2E Harness User' }` to `/api/auth/sign-up/email`.
2. Captures all `Set-Cookie` headers via `headers.getSetCookie()` (Node fetch — preserves multi-value cookies that `.get()` collapses).
3. Joins the cookie names + values with `'; '` and exposes the result as `harness.authCookie`.
4. `makeHttpClient` sends every request with `cookie: authCookie`.
5. `makeCollector` (Socket.IO) attaches the same string via `extraHeaders.cookie`. The `auth.cookie` payload field is sent too, so `authorization-enforcement` can read it from `client.handshake.auth` later without changing the harness.

Because each harness owns its own DB (via `TEST_STACK_ENV` → `docker-compose.test.yml`), a fresh email per harness is enough — no need to clean the `user` table between runs.

## Data model

The Better Auth tables (`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`) are generated into `packages/database/prisma/schema.prisma` by `npx @better-auth/cli generate` and pasted in. Better Auth populates them itself; **Conduit business code never reads or writes them directly** — go through the `auth` instance exposed via `AuthModule`. Full schema text and per-column notes: [data-model.md § Better Auth tables](../data-model.md#better-auth-tables).

## GitHub OAuth → Credential mirror

Better Auth owns the `account` table; Conduit's runtime resolves tokens through `Connection → Credential` and never reads `account` directly. To avoid prompting for a PAT the user just signed in with, `auth.config.ts` mirrors the OAuth `account` row into a Conduit `Credential` via `databaseHooks.account.{create,update}.after`. The hook resolves the user's personal org, looks up the GitHub login for the credential name, and delegates the write to `CredentialsService.upsertOAuthDerived`. Failures are logged and swallowed — sign-in succeeding without a mirror is recoverable (re-sign-in or paste a PAT manually).

The hooks run inside Better Auth's Express middleware, before Nest DI is wired, so `auth.config.ts` constructs a module-level `CredentialsService` against the singleton Prisma client — the same pattern used for `auditLogService` in the same file.

The Credential side of this contract (provenance metadata, idempotency, PAT-rotation conversion) is documented in [connections.md > OAuth-derived credentials](./connections.md#oauth-derived-credentials).

## Handing off to next sub-features

- The `auth` instance is exported as a `Symbol.for('conduit.auth')` provider (`AUTH`). The `databaseHooks` (signup → personal-org, session → `activeOrganizationId`) ship with `tenant-partitioning`; see [tenant-partitioning.md](./tenant-partitioning.md).
- `req.session.activeOrganizationId` is read by `@OrgId()` (`apps/api/src/auth/org-id.decorator.ts`).
- The harness already threads the cookie into Socket.IO's `auth` handshake payload — `authorization-enforcement` only needs to read it on the server side.
