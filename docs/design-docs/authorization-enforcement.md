# Authorization Enforcement

How Conduit closes the loop between "user is logged in + services accept `orgId`" and "every API surface refuses cross-org access." Sister doc to [auth-integration.md](./auth-integration.md) (mount + REST guard) and [tenant-partitioning.md](./tenant-partitioning.md) (`@OrgId()` + service-layer org filtering). This file covers the **trust contract** around `activeOrganizationId`, the WS-side authentication on `RunsGateway`, the webhook → run org chain, and the v1 RBAC stance.

Out of scope here:
- Org switcher / member-management UI / invitations — `org-on-signup-and-switching`.
- Rate limits, audit log — `operational-hardening`.

## Trust contract

`req.session.activeOrganizationId` (set by Better Auth's `organization` plugin) is treated as authoritative end-to-end. The plugin only allows `setActiveOrganization` for orgs the caller is a member of, so the column on the session row is by construction trustworthy. Conduit does **not** re-check membership on every authenticated request.

The accepted trade-off is a membership-staleness window: revoking a member from Org X does not auto-invalidate sessions that already carry `activeOrganizationId = X`. Operators with stricter requirements call Better Auth's session-management endpoints to revoke specific sessions when they remove members. v1 favors the per-request cost of the hot path over instantaneous revocation; revisit when the threat model demands it.

## Signup-time shim — placement matters

`apps/api/src/auth/auth.config.ts` makes the `@OrgId()` precondition resolvable from the very first request after sign-up. The work happens in **`session.create.before`**, not `user.create.after`:

```
session.create.before(session)
  └─ ensurePersonalOrgFor(userId)
       ├─ existing = prisma.member.findFirst({ userId })
       ├─ if existing → return existing.organizationId
       └─ else
            ├─ user = prisma.user.findUniqueOrThrow({ id: userId })
            ├─ org  = auth.api.createOrganization({ userId, name, slug })
            └─ return org.id
  └─ return { data: { ...session, activeOrganizationId: orgId } }
```

The reason is that Better Auth queues `*.after` hooks via `queueAfterTransactionHook`, which only fires once `runWithTransaction` unwinds. Sign-up's `createUser → createSession` both run **inside** that transaction. If the personal org were created in `user.create.after`, the brand-new session row would already be persisted with `activeOrganizationId = null` by the time the org existed — every fresh sign-up's first authenticated request would hit `403 No active organization on session`.

By stamping the value during `session.create.before`, we set it on the row at insert time and the very first cookie carries an active org. The helper is idempotent (`findFirst` returns the existing membership on every subsequent session), so signing in on a second device does not create a duplicate personal org.

## REST: `SessionGuard` + `@OrgId()`

Same as before — see [auth-integration.md](./auth-integration.md) and [tenant-partitioning.md](./tenant-partitioning.md). 401 → no session, 403 → session has no active org, 404 → exists in another org or doesn't exist (single shape).

## Socket.IO: same cookie, same org check

`apps/api/src/modules/runs/runs.gateway.ts` is the only WS surface in v1. The gateway authenticates `/runs` handshakes against the same Better Auth session cookie as REST, then asserts that the requested `runId` belongs to the session's active organization.

```
handleConnection(client)
  ├─ runId = client.handshake.query.runId
  ├─ if missing → client.disconnect(true)
  ├─ auth = resolveWsSession(client.handshake.headers)   // ws-session.ts
  │     └─ auth.api.getSession({ headers: fromNodeHeaders(...) })
  ├─ if no session → client.disconnect(true)
  ├─ orgId = auth.session.activeOrganizationId
  ├─ if !orgId → client.disconnect(true)
  ├─ run = prisma.workflowRun.findFirst({ where: { id: runId, orgId } })
  ├─ if !run → client.disconnect(true)
  └─ client.join(`run:${runId}`)
```

**Why a single-shape disconnect.** Mismatched-org and run-not-found both result in `client.disconnect(true)` with no error payload. An attacker probing run ids cannot distinguish "wrong org" from "does not exist" — defense in depth on top of the REST 404 convention.

**Reconnects re-run `handleConnection`.** Socket.IO's default behavior; we don't override it. So org context is re-checked on every reconnect, and a session change between connect and reconnect does not extend the original trust.

`apps/api/src/auth/ws-session.ts` exposes `resolveWsSession(headers)` so any future gateway can reuse the same plumbing without re-deriving the cookie / Headers shim.

### Web client

`apps/web/src/hooks/use-run-updates.ts` passes `withCredentials: true` to `io()`. This is the WebSocket equivalent of `credentials: 'include'` on `fetch` — required for the dev `:5173` → `:3001` cross-origin cookie to reach the gateway. Production same-origin works without the flag, but it's harmless and we leave it on.

The cors config on the gateway (`origin: config.corsOrigin, credentials: true`) is set in `runs.gateway.ts:20` and was already correct from earlier work.

## Webhooks: HMAC + workflow-stamped `orgId`

`POST /api/hooks/:workflowId` is **deliberately unguarded** by `SessionGuard`. Authenticity comes from the HMAC over the raw body (verified against the workflow row's `webhookSecret`). Tenant attribution flows from the workflow row, not the caller:

```
WebhooksController.handleDelivery
  └─ WorkflowsService.startRun(workflow)
       ├─ orgId = workflow.orgId      // single source of truth
       ├─ prisma.workflowRun.create({ orgId, workflowId: workflow.id, ... })
       └─ Temporal startWorkflow(...)
```

There is **no caller-controlled org input on the webhook path**. A delivery against an Org A workflow can only ever produce an Org A run, regardless of what HTTP headers or body fields the caller sends. The downstream `NodeRun` and `ExecutionLog` rows inherit the run's `orgId` (see [tenant-partitioning.md](./tenant-partitioning.md)), so the entire derived chain is single-org.

Cross-org REST reads of the resulting `runId` resolve as 404 from the service-layer filter; cross-org WS subscribes are rejected by the gateway.

## Cross-org → 404 (project-wide convention)

Formalized here. Three surfaces, three matching shapes, all emitting "no information cross-org":

| Surface | Cross-org outcome | Same-org "doesn't exist" outcome |
|---|---|---|
| REST | `404 Not Found` from the service-layer `findFirst({ orgId, id })` | `404 Not Found` (same shape) |
| Socket.IO | `client.disconnect(true)`, no event emitted | `client.disconnect(true)` (same shape) |
| Webhook | n/a — caller can't pick the org | HMAC failure or unknown id → `404` |

403 is reserved for the structural case "your session has no active org" (`@OrgId()` precondition failure). 401 is reserved for "no session at all" (`SessionGuard`). 404 is the cross-tenant outcome.

## RBAC: flat within an org for v1

Any member — `owner`, `admin`, or `member` per Better Auth's role defaults — can read and write any tenant-scoped row in their org: workflows, credentials, connections, runs, including delete and cancel. The only role-distinguishing operations are member-management ones (invite, remove, role change, delete org), and those live entirely on Better Auth's `organization` plugin under `/api/auth/organization/*`. The plugin enforces role gates internally (`owner` = everything, `admin` = invite + remove non-owners + role-change non-owners, `member` = leave only). Conduit does **not** layer its own RBAC over those endpoints.

Reasoning: v1's threat model is *cross-tenant leakage*, not *intra-tenant misuse*. Adding per-action RBAC later is a strictly additive change; retracting per-action rules already shipped is messier.

## Tests

| Layer | File | What it locks |
|---|---|---|
| API contract | `apps/api/test/contract/org-id-decorator.test.ts` | `@OrgId()` returns `activeOrganizationId` when set; throws `ForbiddenException` when missing/null. |
| API contract | `apps/api/test/contract/{workflows,connections,credentials,runs,trigger}-cross-org.test.ts` | Service-layer `findFirst({ orgId, ... })` rejects cross-org reads + writes. |
| E2E | `test/e2e/cross-org-isolation.test.ts` | REST surface end-to-end: Org A cannot list / read / mutate Org B's rows; cross-org returns 404, never 403. |
| E2E | `test/e2e/authz-enforcement.test.ts` | Webhook → run.orgId == workflow.orgId; cross-org REST GET on the run returns 404; Org B's session WS-subscribing to Org A's runId is disconnected with no frames; anonymous WS connect is disconnected. |

The `test/e2e/harness.ts` exposes two helpers tests use:

| Helper | Purpose |
|---|---|
| `createSecondOrg()` | Sign up a second user (fresh email) and return their auth-cookie + http client. Each user owns their own personal org via the signup shim, so the two clients live in different orgs by construction. |
| `connectSocket(runId, { cookie? })` | Open a Socket.IO connection to `/runs?runId=<id>` with arbitrary cookie or none. Returns `{ waitForConnect, waitForDisconnect, framesReceived, close }` — used by the WS cross-org and no-cookie rejection probes. |

## File layout

```
apps/api/src/auth/
  auth.config.ts            # session.create.before → ensurePersonalOrgFor
  auth.module.ts            # @Global() — exports SessionGuard, AUTH symbol
  session.guard.ts          # REST guard
  org-id.decorator.ts       # @OrgId() — reads session.activeOrganizationId
  ws-session.ts             # resolveWsSession(handshake.headers) — gateway helper
  better-auth.middleware.ts # /api/auth/* mount
  auth.controller.ts        # /api/auth-config

apps/api/src/modules/runs/
  runs.gateway.ts           # WS auth + org-scoped room join
```

The gateway pulls `RedisService`, `PrismaService`, and `auth` from the global `RedisModule`, `CommonModule`, and `AuthModule` — no explicit imports needed in `runs.module.ts`.
