# Authentication

Multi-tenant authentication for Conduit. Built on [Better Auth](https://better-auth.com/) with the `organization` plugin, configured in two modes — `local` (indie dev on `localhost`, lenient rate limits, no email transport required) and `hosted` (invitation-gated registration, every signup gets their own org, conservative rate limits, GitHub + GitLab OAuth available). Every business row is partitioned by `orgId`; every API surface (REST, WebSocket, webhook) refuses cross-org access; member management is delegated end-to-end to Better Auth. This doc is the umbrella entry point — start here, then drill into the sub-feature docs below.

## Sub-feature docs

The auth umbrella ships as eight focused subsystems. Each owns a thin slice; this doc documents the **cross-cutting** rules that span multiple sub-features.

| # | Sub-feature | Owns |
|---|---|---|
| 1 | [auth-integration.md](./auth-integration.md) | Better Auth mount, `SessionGuard`, public `/api/auth-config`, harness signup. |
| 2 | [connections-reshape](#) — see [connections.md](./connections.md) | `Credential` + `Connection` model split, typed scope union, workflow `webhookSecret`. (Sequenced into the umbrella because the org-partitioning column attaches to the new shape.) |
| 3 | [tenant-partitioning.md](./tenant-partitioning.md) | `orgId` on every business row, `@OrgId()` decorator, signup-time shim, cross-org → 404 contract. |
| 4 | [authorization-enforcement.md](./authorization-enforcement.md) | `activeOrganizationId` trust contract, Socket.IO auth on `RunsGateway`, webhook → run org chain, v1 RBAC stance, cross-org → 404 convention. |
| 5 | [web-auth-ui.md](./web-auth-ui.md) | `AuthLayout` / `RequireAuth` shell, sign-in / sign-up / forgot / reset / account pages, `UserMenuPill`, web `auth-client`. |
| 6 | [org-switching.md](./org-switching.md) | Organizations section in `UserMenuPill`, members + invitations management, `/accept-invitation/:id` deep link, copyable invite URL fallback. |
| 7 | [operational-hardening.md](./operational-hardening.md) | Better Auth rate limits (mode-aware, Redis-backed), `AuditLog` model, failed-login-spike abuse signal. |
| 8 | [oauth-account-linking.md](./oauth-account-linking.md) | In-app link/unlink of GitHub + GitLab identities, refuse-while-referenced unlink, OAuth token refresh sweep, platform-aware git username. |

[SECURITY.md § API auth & tenant isolation](../SECURITY.md#api-auth--tenant-isolation-operator-summary) is the operator-facing summary; this doc is the developer-facing umbrella.

## Deployment modes

`CONDUIT_DEPLOYMENT=local|hosted` (default `local`). **Config-only, not flow-divergent** — the user flow (signup → land in own org → log in normally) is identical in both modes. The flag drives:

| Concern | `local` | `hosted` |
|---|---|---|
| Registration | Open — any email can sign up | **Invitation-gated** — only seeded or invited emails may register (see below) |
| Rate limits on `/api/auth/*` | 100/hr (lenient) | 5–10/hr per endpoint (see [operational-hardening.md](./operational-hardening.md)) |
| GitHub / GitLab OAuth | Each available iff that provider's `_CLIENT_ID` + `_CLIENT_SECRET` are set | Same — env-gated, not mode-gated |
| Email verification | `requireEmailVerification: false` (no email transport yet) | Same; flips to `true` when transport ships |
| Personal-org auto-create on signup | Yes | Yes |

`local` just happens to have one user, open registration, and lenient rate limits — there is no first-boot owner auto-provision, no token-URL-to-console, no zero-config bypass.

### Invitation gate (hosted only)

In `hosted` mode, registration is **not public**. `auth.config.ts`'s `databaseHooks.user.create.before` (`apps/api/src/auth/auth.config.ts`) lets a signup through only if the email is **seeded** (matches `config.seedEmails`, sourced from `CONDUIT_SEED_EMAILS` — exact addresses, or `@domain` suffixes) or has a **pending, unexpired `Invitation`** row for that address. Any other email throws `403 'Registration is by invitation only'`. The hook is a no-op in `local` mode (returns early when `deployment !== 'hosted'`), so open registration is the `local` default.

## Signup → org creation flow

The crossover that touches the most sub-features. A fresh `POST /api/auth/sign-up/email` runs:

```
1. Better Auth: insert into `user`
2. Better Auth: insert into `account` (hashed password)
3. session.create.before hook (tenant-partitioning):
   ├─ ensurePersonalOrgFor(userId)
   │   ├─ existing = prisma.member.findFirst({ userId })
   │   ├─ if existing → return existing.organizationId
   │   └─ else → auth.api.createOrganization({ userId, name: "<localpart>'s workspace", slug })
   └─ return { ...session, activeOrganizationId: orgId }   ← stamped at insert time
4. Better Auth: insert into `session` (carries activeOrganizationId)
5. Set-Cookie: better-auth.session_token=…
```

**Why `session.create.before` and not `user.create.after`** — Better Auth's `*.after` hooks fire after the surrounding transaction unwinds, by which time the new session row is already persisted with `activeOrganizationId = null`. The earlier shim location ran the org create after session insert, so the very first authenticated request hit `403 No active organization`. The current shim stamps the value before insert; the helper is idempotent so signing in on a second device does not create a duplicate personal org.

See [authorization-enforcement.md § Signup-time shim](./authorization-enforcement.md#signup-time-shim--placement-matters) for the full hook code.

## The three auth planes

| Plane | Authenticates via | Owned by | Failure mode |
|---|---|---|---|
| REST `/api/*` (except webhook) | Session cookie → `SessionGuard` calls `auth.api.getSession({ headers })` | [auth-integration.md](./auth-integration.md) | 401 on no session, 403 on no active org, 404 on cross-org |
| WebSocket `RunsGateway` | Same cookie, parsed from `client.handshake.headers` | [authorization-enforcement.md](./authorization-enforcement.md) | `client.disconnect(true)` on any failure (single shape, no leakage) |
| Webhook `POST /api/hooks/:workflowId` | HMAC-SHA256 over raw body, secret on `Workflow.webhookSecret` | [connections.md](./connections.md) | 401 on signature mismatch |

Webhooks deliberately stay HMAC-only — the platform sending the delivery doesn't carry a session cookie, and the workflow row keys the resulting run's `orgId` so there's no caller-controlled org input on this path.

## Cross-cutting rules (owned elsewhere)

The contracts that span every sub-feature are documented once, in the sub-feature that owns them. One-line summaries with the canonical link:

- **Trust contract.** `req.session.activeOrganizationId` (set by the `organization` plugin) is authoritative end-to-end; Conduit does not re-check membership per request, accepting a membership-staleness window. Full version: [authorization-enforcement.md § Trust contract](./authorization-enforcement.md#trust-contract).
- **Same-org invariant.** `orgId` is denormalized onto every leaf row and services pass it into every `where`/`data` clause so a missed filter fails closed. See [tenant-partitioning.md § Same-org invariant](./tenant-partitioning.md#same-org-invariant).
- **Cross-org → 404, never 403.** A request for another org's row id resolves as not-found, never confirms existence, uniformly across REST / WS / template-apply. See [authorization-enforcement.md § Cross-org → 404](./authorization-enforcement.md#cross-org--404-project-wide-convention).
- **v1 RBAC: flat within an org.** Any member (any role) can read/write any tenant-scoped row; the only role-gated operations are member-management, enforced inside the `organization` plugin. The threat model is cross-tenant leakage, not intra-tenant misuse. See [authorization-enforcement.md § RBAC](./authorization-enforcement.md#rbac-flat-within-an-org-for-v1).
- **Operational posture.** Rate limits (Redis-backed, mode-aware), the `AuditLog` model + event taxonomy, and the failed-login-spike abuse signal all live in [operational-hardening.md](./operational-hardening.md).

## Member management

Every member-management operation — invite, remove, role-change, leave, delete-org, accept/reject invitation — is delegated to Better Auth's `organization` plugin endpoints under `/api/auth/organization/*`. **No Conduit-side routes layer over them.** The plugin gates by role internally per its defaults: `owner` does everything, `admin` invites and removes non-owners and changes non-owner roles, `member` can leave only.

## Cross-cutting status

- **Email transport is OFF.** `requireEmailVerification: false`, `sendOnSignUp: false`, `sendInvitationEmail` not implemented. Until transport ships (Resend / Postmark / SMTP), invitations surface a copyable URL via [org-switching.md](./org-switching.md), password-reset request is a no-op end-to-end, and email-verification is not required. Single follow-up issue gates flipping all four to `true`.
- **Cookie domain for hosted-prod** is unresolved. `local` and CI work on `localhost:5173 ↔ localhost:3000` with default `sameSite=lax`. Single-domain reverse-proxy vs. cross-subdomain `sameSite=lax` is decided when the hosted deployment is provisioned, not in this umbrella.
- **No per-org Temporal task queue** in v1. All orgs share the existing single queue; `agentWorkflowId` already disambiguates by `runId` / ticket key.
- **Push credentials in `ticket-branch` workspaces** stay per-run-scoped — no org-level change to the existing model. The org boundary is enforced before run dispatch.

## Where the code lives

```
apps/api/src/auth/
├── auth.config.ts           ← Better Auth instance, signup shim, rate-limit + audit hooks
├── auth.module.ts           ← @Global module exposing AUTH provider + AuditLogService
├── auth.controller.ts       ← public GET /api/auth-config
├── better-auth.middleware.ts← Express adapter, mounted before express.json()
├── session.guard.ts         ← Nest CanActivate calling auth.api.getSession
├── ws-session.ts            ← Socket.IO handshake → session resolver
├── org-id.decorator.ts      ← @OrgId() reads req.session.activeOrganizationId
├── audit-events.ts          ← closed AuditEvent union + AUDIT_EVENTS list
├── audit-log.service.ts     ← AuditLogService.record(...)
├── audit-hooks.ts           ← Better Auth hooks.after + organizationHooks
├── abuse-signals.ts         ← failed-login-spike threshold check
├── rate-limit-config.ts     ← mode-aware rate-limit numbers
├── oauth-mirror-hooks.ts    ← account.{create,update}.after mirror + delete.{before,after} unlink
├── token-refresh*.ts        ← OAuth token refresh sweep + Nest interval + per-account Redis lock
└── types.ts                 ← Express.Request augmentation

apps/api/src/redis/redis.service.ts
   └── betterAuthSecondaryStorage()   ← adapts Redis to Better Auth's secondaryStorage interface

apps/web/src/lib/auth-client.ts        ← Better Auth React client, organizationClient() registered
apps/web/src/api/auth-config.ts        ← TanStack Query hook for GET /api/auth-config
apps/web/src/api/organization.ts       ← TanStack Query hooks wrapping authClient.organization.*
apps/web/src/components/layout/        ← AuthLayout, RequireAuth, RedirectIfAuthed, UserMenuPill
apps/web/src/pages/                    ← SignIn, SignUp, Forgot, Reset, Account, OrganizationSettings, Invitations, AcceptInvitation

packages/database/prisma/schema.prisma ← Better Auth tables + AuditLog + orgId on 9 tenant rows
```

The interface boundary for self-host operators who want to fork is the **`SessionGuard` + the user/org context shape exposed to controllers**. Better Auth config lives in one module so a self-hoster can swap providers, disable signup, add MFA, or replace it entirely without touching the rest of Conduit.

## Future work

- **Email transport** — flips `requireEmailVerification`, `sendOnSignUp`, `sendVerificationEmail`, `sendResetPassword`, `sendInvitationEmail` all `true`. Single follow-up.
- **Audit log entries for cross-org rejections** — instrumenting every service `where: { orgId }` site is too noisy; revisit when the existing `auth.*` + `org.member.*` events prove insufficient.
- **Per-action RBAC inside an org** — re-open when a real use case shows up.
- **Auto-revoke-on-member-removal** and per-request membership re-check — revisit when the threat model demands it.
- **Per-org Temporal task queue** — scaling lever, not correctness.
- **Per-org quotas / billing** — the natural next umbrella. `WorkflowRun.orgId` is already in place; an `Organization` model + plan/limit columns slot in cleanly without disturbing this auth umbrella's contracts.
- **Cookie-domain configuration for hosted prod** — decided when hosted is provisioned.
- **Operational: external alerting on abuse signals**, **auto-block on spike**, **CAPTCHA on signup**, **MFA / passkeys / IP allow-listing per org** — all explicit non-goals for v1.
