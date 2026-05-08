# Operational hardening

Closes the auth umbrella. Three concerns kept together because they share `apps/api/src/auth/auth.config.ts` and a single `docs/SECURITY.md` paragraph: rate-limiting on the abuse-prone Better Auth endpoints, an append-only `AuditLog` for security-relevant events, and one inline abuse signal (failed-login spike → structured warn line).

Out of scope here:
- Tenant scoping and the cross-org-404 convention — see [tenant-partitioning.md](./tenant-partitioning.md).
- v1 flat-RBAC and the membership-staleness window — see [authorization-enforcement.md](./authorization-enforcement.md).
- Org switching, members management, and invitation UI — see [org-switching.md](./org-switching.md).
- Webhook rate-limits and per-org rate-limits — explicit non-goals (see below).

## Module layout

`apps/api/src/auth/` gains four new files; existing files (`auth.config.ts`, `auth.module.ts`) are extended:

| File | Role |
|---|---|
| `audit-events.ts` | `const AUDIT_EVENTS` runtime list + closed `AuditEvent` type union. Out-of-list strings are a type error at the writer. |
| `audit-log.service.ts` | `AuditLogService.record({ event, actorUserId?, actorEmail?, actorIp?, orgId?, targetUserId?, metadata? })`. Single method; no `query`/`list` API in v1. |
| `abuse-signals.ts` | `AbuseSignalsService.checkFailedLoginSpike({ actorEmail })`. Counts failures in the last 5 min; emits `logger.warn` over threshold. |
| `audit-hooks.ts` | `createAuditAfterMiddleware()` (Better Auth `hooks.after` for auth events) + `createOrganizationAuditHooks()` (typed `organizationHooks` for org events). |
| `rate-limit-config.ts` | Pure `rateLimitConfig(deployment)` — the source-of-truth for the hardening table. Imported by `auth.config.ts`; unit-tested in isolation. |

Modified:

- `auth.config.ts` — wires `secondaryStorage`, `rateLimit`, `hooks.after`, and the `organization()` plugin's `organizationHooks` into the Better Auth instance.
- `auth.module.ts` — registers `AuditLogService` + `AbuseSignalsService` as Nest providers (for tests; production writes happen from middleware before any controller runs).
- `redis/redis.service.ts` — adds `betterAuthSecondaryStorage()` + a free helper `createBetterAuthRedisStorage(redis)` used by `auth.config.ts`'s module-level Redis client.

## Rate limits

Better Auth's built-in rate-limit middleware does the work. No Conduit-side rate-limit code. Counters live in Redis via Better Auth's `secondaryStorage` adapter, so a horizontally-scaled API tier shares one budget across processes. If Redis is unreachable at API startup the process fails to boot — same posture as `RedisService` for the Socket.IO gateway. **No silent fallback to memory.**

Numbers are mode-tuned per `CONDUIT_DEPLOYMENT`:

| Endpoint                                       | `local` (per IP) | `hosted` (per IP) |
| ---------------------------------------------- | ---------------- | ----------------- |
| `/api/auth/sign-up/email`                      | 100 / hr         | 5 / hr            |
| `/api/auth/sign-in/email`                      | 100 / hr         | 10 / 5 min        |
| `/api/auth/request-password-reset`             | 100 / hr         | 5 / hr            |
| `/api/auth/organization/accept-invitation`     | 100 / hr         | 10 / hr           |
| Default for any other `/api/auth/*`            | 100 / min        | 100 / min         |

`local` is *not* "off" — it's lenient enough to never punish dev iteration but still cap an accidental infinite loop. `hosted` numbers are conservative-but-usable: a real user won't trip them; a script will. Per-IP is the only correlation axis. Numbers are constants in `rate-limit-config.ts`, not env-tunable: a security knob without experience-driven defaults is a footgun, and a one-line patch is sufficient if real traffic shows false-positives.

Rate-limit storage keys are `<ip>|<path>` (Better Auth's internal shape); the test suite calls `FLUSHDB` on the test Redis between scenarios.

## Audit log

One Prisma table written by `AuditLogService` from two surfaces:

1. **Better Auth `hooks.after` middleware** — path-dispatching for auth events:
   - `/sign-in/email` → `auth.signIn` on success (`ctx.context.newSession` set), `auth.signIn.failed` on `UNAUTHORIZED` (statusCode 401). Other errors (5xx, validation, `FORBIDDEN` for unverified email) write no row.
   - `/callback/<provider>` → `auth.signIn` (with `metadata.provider`).
   - `/sign-up/email` → `auth.signUp`.
   - `/sign-out` → `auth.signOut`.
   - `/request-password-reset` → `auth.passwordReset.requested`.
   - `/reset-password` → `auth.passwordReset.completed`.
2. **`organization()` plugin's typed `organizationHooks`** — for org events. Compared to the path-pattern dispatch, these expose typed `member` / `previousRole` / `organization` payloads that would otherwise require a synthetic re-query:
   - `afterCreateOrganization` → `org.created`
   - `afterDeleteOrganization` → `org.deleted`
   - `afterUpdateOrganization` → `org.renamed` (only the new name lands in `metadata.to` — see *Trade-offs* below)
   - `afterCreateInvitation` → `org.member.invited` (with `inviteeEmail`, `role`)
   - `afterAcceptInvitation` → `org.member.invitationAccepted`
   - `afterRejectInvitation` → `org.member.invitationRejected`
   - `afterCancelInvitation` → `org.member.invitationRevoked`
   - `afterRemoveMember` → `org.member.removed` (admin removed someone) or `org.member.left` (self-leave) — split on whether actor === target
   - `afterUpdateMemberRole` → `org.member.roleChanged` with `metadata.from` and `metadata.to`

Both surfaces fire only on operation success — the spec's "audit row written only after the underlying operation succeeded" principle holds. Audit-write failures are swallowed inside the hooks so a transient DB hiccup can't break sign-in or org operations.

### Schema (no FK divergence — the divergence is the point)

```prisma
model AuditLog {
  id            String   @id @default(cuid())
  event         String   // closed taxonomy enforced in TS — see audit-events.ts
  actorUserId   String?  // plain string, NOT an FK
  actorEmail    String?
  actorIp       String?
  orgId         String?  // plain string, NOT an FK
  targetUserId  String?  // plain string, NOT an FK
  metadata      Json?
  createdAt     DateTime @default(now())

  @@index([orgId, createdAt(sort: Desc)])
  @@index([actorEmail, event, createdAt])
  @@map("audit_log")
}
```

Plain string columns instead of foreign keys for the actor / org / target pointers. This breaks the convention every other tenant-scoped row follows; the divergence is the point. Audit rows are not operational data — their value is "this was true at write time and nothing can change that," which is exactly what FK relations + cascade rules undermine. A future migration changing `onDelete: SetNull` to `Cascade` would silently rewrite history; the no-FK shape forecloses that.

The trade-off is no DB-level integrity check on the linkage and joins via raw `LEFT JOIN audit.actorUserId = user.id` rather than Prisma relations — acceptable for a write-mostly table queried from operator tooling, not from the app's hot paths. The contract test suite locks the no-FK guarantee against schema drift by deleting a referenced user and asserting the audit row's `actorUserId` column is unchanged.

### Closed event taxonomy

Defined as a `const` array + derived union type in `audit-events.ts`:

```
auth.signIn                       org.created
auth.signIn.failed                org.deleted
auth.signUp                       org.renamed
auth.signOut                      org.member.invited
auth.passwordReset.requested      org.member.invitationAccepted
auth.passwordReset.completed      org.member.invitationRejected
                                  org.member.invitationRevoked
                                  org.member.removed
                                  org.member.roleChanged
                                  org.member.left
```

Adding a new event = adding a new entry here, plus a hook that emits it. Out-of-list strings are a TypeScript error at `AuditLogService.record`.

### Trade-offs

- **`org.renamed` records `metadata.to` only, not `metadata.from`.** The plugin's `afterUpdateOrganization` payload exposes the post-update org but not the pre-update name, and querying for it in the hook would require either a stash via `beforeUpdateOrganization` (no shared `ctx`) or an extra DB read. The new name in metadata is the load-bearing signal; `from` would be useful but not required for v1 incident response.
- **Direct `afterAddMember` is not logged.** Invitation-driven joins are covered by `afterAcceptInvitation`; the signup-shim's auto-create personal org is covered by `afterCreateOrganization`. The remaining direct-add path (an admin programmatically adding a member without invitation) doesn't have a v1 user-facing flow, so a dedicated event would be over-spec.

## Abuse signal: failed-login spike

Inside the `auth.signIn.failed` hook, immediately after writing the audit row, `AbuseSignalsService.checkFailedLoginSpike({ actorEmail })` counts failures for the same email in the last 5 minutes. Threshold is **`count > 10`** — strict greater-than, so exactly 10 failures within the window does not trigger; the 11th does. The spike emits one `logger.warn` line with event `abuse.failedLoginSpike` plus the email, count, and window.

The threshold sits *just above* the per-IP rate-limit cap on `/sign-in/email` (10 / 5 min in hosted mode). Tripping it implies the attacker is rotating IPs against a single email — exactly the case rate-limit alone can't surface. Threshold and window are constants in code, not env-tunable.

v1 detects, doesn't react. There is no auto-block, no account lock, no IP throttle escalation, no external alerting. A real customer ask reopens this; until then a one-line `logger.warn` is enough to surface the signal in operator log aggregation if/when desired.

## Configuration

Reuses the existing `CONDUIT_DEPLOYMENT` switch and `REDIS_URL` (from `apps/api/src/config.ts`):

| Field | Env | Default | Purpose |
|---|---|---|---|
| `deployment` | `CONDUIT_DEPLOYMENT` | `local` | `local \| hosted`. Drives the rate-limit table. |
| `redis.url` | `REDIS_URL` | `redis://localhost:6379` | Powers Better Auth's `secondaryStorage` for shared rate-limit counters. |

No new env vars. Threshold (10 in 5 min) and rate-limit numbers are constants in code.

## Tests

| Layer | File | Covers |
|---|---|---|
| unit | `apps/api/src/auth/audit-log.service.test.ts` | `record({...})` mapping; null-safe optional fields; `Prisma.JsonNull` for missing metadata. |
| unit | `apps/api/src/auth/abuse-signals.test.ts` | Threshold boundary (9 / 10 / 11 failures); auditLog query shape. |
| unit | `apps/api/src/auth/rate-limit-config.test.ts` | Local-mode lenient table + hosted-mode tight table. |
| api | `apps/api/test/contract/audit-log.test.ts` | Sign-up/in/out + org events write the right row; user-delete doesn't break the audit row (no-FK guarantee); 11 failed sign-ins trigger one warn, 10 don't. |
| api | `apps/api/test/contract/audit-rate-limit.test.ts` | 11th `/sign-in/email` from one IP returns 429; per-IP isolation. |

The api project boots `process.env.CONDUIT_DEPLOYMENT=hosted` in `global-setup.ts` so the rate-limit suite drives the hosted-mode numbers; local-mode lenience is verified by the unit test against `rateLimitConfig('local')` directly. The api project also force-pins `DATABASE_URL` and `REDIS_URL` to the test stack so `auth.config.ts`'s module-level Redis client connects to `:56379`, not dev.

## Explicit non-goals

The umbrella ships with these intentional gaps; reopen each via its own follow-up sub-feature:

- **Audit log entries for cross-org rejections (404s).** Capturing them cleanly without instrumenting every service `where: { orgId }` site is non-trivial. Defer to v2.
- **Audit log UI / admin endpoint.** Operators query the table directly. UI is a follow-up after the umbrella ships.
- **Audit log retention / GDPR redaction tooling.** Audit rows are kept forever in v1. The no-FK shape makes future redaction (null specific columns) safer than a cascade-delete model.
- **External alerting on abuse signals.** PagerDuty / Slack / email integrations are out — v1 emits the structured log line, and downstream alerting integrates against operator log aggregation.
- **Auto-block / account-lock on spike.** v1 detects, doesn't react.
- **CAPTCHA / proof-of-work on signup.** Add when the abuse signals show rate-limit isn't enough.
- **Geo-IP throttling, IP reputation lookup, WAF rules.** Infra-layer; not in the application.
- **Per-org rate limits.** Webhooks aren't in operational-hardening's scope at all — bounded to Better-Auth-owned endpoints.
- **Session-end events beyond explicit sign-out.** Session expiry and admin-revoke are not logged in v1; admin-revoke gets a new `auth.session.revoked` event when that flow ships.
- **Failed-login spike correlation by IP.** Email-only for v1.
- **Configurable thresholds via env.** Threshold + per-mode rate-limit numbers are constants.
- **MFA, passkeys, IP allow-listing per org.** Out of the auth umbrella.
- **Cookie-domain configuration for hosted-prod.** Same deferral as the rest of the umbrella.

## Handing off

This is the last sub-feature in the auth umbrella. The umbrella overview at [authentication.md](./authentication.md) collects the per-feature docs into a single read-order pass; consult it for the cross-cutting picture.
