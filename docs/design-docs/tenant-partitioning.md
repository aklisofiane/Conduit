# Tenant Partitioning

How Conduit keeps one organization's business data isolated from another's. Every business-data row carries `orgId` (FK to `Organization.id`); every API service method takes `orgId` as an explicit parameter; the worker chains `orgId` through the rows it loads. Cross-org id references resolve as **404, never 403** — we never confirm the existence of sibling-org rows.

This doc covers:
- The eight partitioned models, the indexes, and the same-org invariant.
- Why the enforcement style is "explicit `orgId` parameter" (not CLS, not a Prisma client extension).
- The `@OrgId()` decorator and the signup-time shim that makes it resolve.
- How worker activities thread `orgId` without an auth context.
- The "cross-org → 404" convention.

Out of scope here:
- The Better Auth mount, `SessionGuard`, `/api/auth-config` — see [auth-integration.md](./auth-integration.md).
- The WS-side counterpart on `RunsGateway`, the trust contract around `activeOrganizationId`, the cross-org-404 convention, and the v1 RBAC stance — see [authorization-enforcement.md](./authorization-enforcement.md).
- Org switcher / members UI / invitations — `org-on-signup-and-switching`.
- Web auth UI — see [web-auth-ui.md](./web-auth-ui.md).
- Audit log / rate limit — `operational-hardening`.

## Partitioned models

Every business-data row carries `orgId String` (non-nullable, FK to `Organization.id`, cascade-delete from the org). The eight tenant-scoped models:

| Model | Why partitioned |
|---|---|
| `Workflow` | Top-level user-owned config. List, get, update, delete all scope by `orgId`. |
| `Connection` | Named binding over a Credential. Same-org invariant: `Connection.orgId == Credential.orgId`. |
| `Credential` | Rotatable platform secret. One credential row can back many connections, all in the same org. |
| `WorkflowRun` | Audit + billing prep. Copied from `Workflow.orgId` at run-start. |
| `NodeRun` | Per-node run state. Copied from `WorkflowRun.orgId` at upsert. |
| `ExecutionLog` | High-volume agent event stream. Copied from `WorkflowRun.orgId` at write. |
| `PollSnapshot` | Polling-mode dedup. Copied from `Workflow.orgId` at upsert. |
| `TicketBranch` | Naming cache for `ticket-branch` workspaces. Re-keyed `(orgId, platform, owner, repo, ticketId)`. |

`orgId` is denormalized onto every leaf row. `NodeRun → WorkflowRun → Workflow` could be joined to derive the org, but the explicit column lets a missed filter fail closed instead of leaking sibling-org rows. It also makes future per-org admin / billing / partitioning queries one-hop.

### Indexes

Additive — pre-partitioning indexes stay intact:

| Model | Index | Use |
|---|---|---|
| `Workflow` | `@@index([orgId, isActive])` | "list active workflows in my org" |
| `Connection` | `@@index([orgId, createdAt])` | "list my org's connections, newest first" |
| `Credential` | `@@index([orgId, createdAt])` | same shape for credentials |
| `WorkflowRun` | `@@index([orgId, startedAt])` | per-org run history (billing prep) |

`ExecutionLog`, `NodeRun`, `PollSnapshot`, `TicketBranch` get no new index — current keys remain optimal in v1.

### Unique-key changes

`TicketBranch.@@unique([platform, owner, repo, ticketId])` → `@@unique([orgId, platform, owner, repo, ticketId])`. Two orgs working the same Github repo / ticket get distinct rows (and slugs derived independently). Within an org, Worker + Critic on the same ticket still converge on one row — the desired shared-naming property is preserved.

## Same-org invariant

The writer is responsible for keeping derived rows in the same org as their parent. Nothing in Postgres enforces this — the responsibility lives in the API services and worker activities:

- `Connection.orgId == Credential.orgId` — `ConnectionsService.create` / template-apply enforce.
- Every `Connection` id referenced inside `Workflow.definition.triggers[].connectionId`, `triggers[].boardConnectionId`, and `mcpServers[].connectionId` must point at a Connection in the same org as the Workflow. Cross-org refs reject as 404.
- `WorkflowRun.orgId == Workflow.orgId` — `WorkflowsService.startRun` and `pollBoardActivity` both copy from the loaded workflow row.
- `NodeRun.orgId == WorkflowRun.orgId` — `runAgentNode` activity copies from the run input.
- `ExecutionLog.orgId == WorkflowRun.orgId` — `writeAgentEventLog` / `writeSystemLog` take `orgId` as an explicit parameter.
- `PollSnapshot.orgId == Workflow.orgId` — `pollBoardActivity` copies on upsert.

## Enforcement style: explicit `orgId` parameter

Every API service method that reads or writes a tenant-scoped row takes `orgId: string` as its first business argument and chains it into every `where` / `data` clause. The orgId enters the service layer from controllers via `@OrgId()` (`apps/api/src/auth/org-id.decorator.ts`), which reads `req.session.activeOrganizationId` (set by Better Auth's `organization` plugin) and throws `ForbiddenException` if absent.

**Not used here:** `nestjs-cls`, AsyncLocalStorage, or a Prisma client extension that auto-applies a tenant filter.

Reasons:

- Worker activities have no request context — Temporal runs them on raw functions with `prisma()` and a `runId` parameter. A CLS-based extension wouldn't apply there, so we'd already need an explicit-parameter path for the worker. Maintaining two enforcement styles (extension for API, explicit for worker) is strictly worse than one style.
- Tests instantiate services directly without an HTTP request, so a CLS extension would silently scope-to-undefined unless every test wraps in CLS context — friction the explicit-parameter style avoids.
- Greppable at every call site. A code reviewer can see in the diff that `orgId` was forwarded; nothing's hidden behind middleware they can't see.
- One-time mechanical cost — every method gains one parameter — vs. ongoing hidden-context tax.

### `@OrgId()` decorator

`apps/api/src/auth/org-id.decorator.ts`:

```ts
export const OrgId = createParamDecorator((_, ctx) => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const orgId = req.session?.activeOrganizationId;
  if (!orgId) throw new ForbiddenException('No active organization on session');
  return orgId;
});
```

Wired into every method on these guarded controllers:

| Controller | Methods |
|---|---|
| `WorkflowsController` | `list`, `get`, `create`, `update`, `delete`, `duplicate`, `setWebhookSecret`, `clearWebhookSecret` |
| `ConnectionsController` | `list`, `get`, `create`, `update`, `delete` |
| `CredentialsController` | `list`, `create`, `update`, `delete` |
| `RunsController` | `listForWorkflow`, `get`, `cancel`, `logs`, `logsForNode` |
| `TriggerController` | `listProjects`, `listLabels` |
| `TemplatesController` | `createFromTemplate` only — catalog reads (`list` / `get`) stay unscoped |

`WebhooksController` does **not** call `@OrgId()` — the webhook path is HMAC-only and unguarded, so it reads `workflow.orgId` from the loaded workflow row and forwards that to `WorkflowsService.startRun`.

## Signup-time shim

Because `@OrgId()` requires `activeOrganizationId` on the session, `apps/api/src/auth/auth.config.ts` extends Better Auth with two `databaseHooks`:

| Hook | Action |
|---|---|
| `user.create.after` | Calls `auth.api.createOrganization` (with `userId` set, allowed for system invocations) to create one personal org named `"<email-localpart>'s workspace"` with a randomized slug suffix. |
| `session.create.before` | Looks up the user's first `Member` row and stamps `session.activeOrganizationId` on the new session before the cookie is issued. |

That's the entire shim. Polished naming, the org switcher, members management, and invitations all live in `org-on-signup-and-switching`. The slug suffix is `Math.random().toString(36).slice(2, 8)` — collision probability is fine for v1 and gets a proper "name your workspace" UI later.

### Verified Better Auth API surface

Better Auth's `organization` plugin (verified against the live `node_modules/better-auth/dist/plugins/organization/`):

| Symbol | Source |
|---|---|
| `session.activeOrganizationId?: string` | session row column added by the org plugin |
| `auth.api.createOrganization({ body: { name, slug, userId, ... } })` | server-side endpoint; `userId` allowed when no session is present |
| `auth.api.setActiveOrganization({ body: { organizationId? \| organizationSlug? } })` | session-bound; not used by the shim — `session.create.before` writes the column directly |

## Cross-org rejection: 404, not 403

A client that knows another org's row id (workflow, run, connection, credential, etc.) and references it through any of the API services gets `NotFoundException` — never `ForbiddenException`. We don't confirm the existence of cross-org rows. The same convention applies to template-apply bindings (`credentialId`, `connectionId`).

Implementation detail: Prisma's `findUnique({ where: { id } })` resolves cross-org rows; we use `findFirst({ where: { id, orgId } })` (or `updateMany` / `deleteMany` for write paths) so a sibling-org id silently misses and surfaces as 404.

## Worker side: chain `orgId` through the loaded row

Worker activities are server-trusted code with no request context. Instead of taking an `orgId` argument, they read it from the row they already load and thread it into derived rows:

| Activity / helper | Reads orgId from | Writes orgId onto |
|---|---|---|
| `loadGraphActivity` | `Workflow.orgId` | returned `LoadedGraph.orgId` |
| `pollBoardActivity` | `Workflow.orgId` | new `WorkflowRun`, new `PollSnapshot` |
| `runAgentNode` | `RunAgentNodeInput.orgId` (forwarded by agent-workflow) | upserted `NodeRun` |
| `cleanupRunActivity` | `WorkflowRun.orgId` (loaded once at activity start) | system log writes |
| `mergeWorktreeActivity` / `copyConduitFilesActivity` | input arg from agent-workflow | system log writes |
| `writeAgentEventLog` / `writeSystemLog` | explicit `orgId` parameter | new `ExecutionLog` |
| `makeTicketBranchStore` (Prisma adapter) | `input.orgId` on `upsert` | new `TicketBranch` |

The agent-workflow (`apps/worker/src/workflows/agent-workflow.ts`) reads `graph.orgId` once and forwards it on every activity call.

`loadConnectionContext` and `makeCredentialLookup` (worker runtime helpers in `apps/worker/src/runtime/`) stay read-only and unscoped — the trust chain `runId → workflowRun.orgId → workflow.orgId → connection.orgId` is the implicit cross-org check, and these are server-trusted lookups by id.

## Unscoped helpers (deliberate)

A handful of code paths run cross-org by design:

| Path | Reason |
|---|---|
| `WorkflowsService.reconcilePollSchedules` | Boot-time, no caller user. Iterates every workflow to rebuild Temporal schedules. The per-workflow `scheduleId = poll:<cuid>` already disambiguates without any per-org prefix. |
| `CredentialsService.decryptForConnection`, `getConnectionBinding` | Server-trusted, called from worker / config-time helpers that already authorized against the workflow row. |
| `TemplatesService.list` / `.get` | Conduit-shipped global content (`/templates/*.json` loaded at boot), not per-org rows. |
| `WebhooksService.handleGithub` | HMAC-authenticated; takes `Workflow.orgId` from the loaded workflow row before forwarding to `startRun`. |

## Migration

Empty-DB-only via `db push`. The schema marks `orgId` `NOT NULL` on day one; anyone with existing dev data resolves it via `npm run db:reset`. No backfill ships. Rationale: Conduit is pre-prod, the dev workflow is `db push` (per `CLAUDE.md`), and tests already run against a `--force-reset`'d DB.

## Tests

| Layer | File | What it checks |
|---|---|---|
| API contract | `apps/api/test/contract/workflows-cross-org.test.ts` | list/get/update/delete/duplicate cross-org all 404 |
| API contract | `apps/api/test/contract/connections-cross-org.test.ts` | list/get/update/delete + cross-org `credentialId` on create → 404 |
| API contract | `apps/api/test/contract/credentials-cross-org.test.ts` | list/update/delete cross-org all 404 |
| API contract | `apps/api/test/contract/runs-cross-org.test.ts` | listForWorkflow returns empty, get/cancel/logs cross-org all 404 |
| API contract | `apps/api/test/contract/trigger-cross-org.test.ts` | listProjects/listLabels reject cross-org connectionId before hitting GitHub |
| API contract | `apps/api/test/contract/org-id-decorator.test.ts` | `@OrgId()` returns the active id on hit, `ForbiddenException` on miss/null/no-session |
| Unit | `packages/agent/src/workspace/ticket-branch.test.ts` | within-org Worker + Critic converge; two orgs on the same ticket get distinct rows |
| E2E | `test/e2e/cross-org-isolation.test.ts` | Two signups → two orgs → orgA cannot see/mutate orgB's workflows / runs / connections / credentials through any API surface |

Canonical fixture: `test/fixtures/orgs/two-orgs.ts` — one helper that seeds two orgs, two workflows, two credentials, two connections, two runs (each with a sample log) so contract specs share one well-known starting state.

The api/contract project uses `pool: 'forks'` + `singleFork: true` + `sequence: { concurrent: false }` because all specs share one Postgres test DB; per-spec `clearTenantData` would race in parallel.

`test/e2e/harness.ts` gains `createSecondOrg()` — a test-code-only helper that signs up a second user and returns their cookie + http client, used by the cross-org E2E.

## File map

```
apps/api/src/auth/
  auth.config.ts          # Better Auth + signup-time shim
  org-id.decorator.ts     # @OrgId() — reads session.activeOrganizationId

apps/api/src/modules/<m>/
  <m>.controller.ts       # @OrgId() forwarded as first arg
  <m>.service.ts          # orgId: string as first business param

apps/worker/src/activities/
  load-graph.ts           # reads Workflow.orgId, returns it on LoadedGraph
  poll-board.ts           # stamps onto new WorkflowRun + PollSnapshot
  run-agent-node.ts       # threads onto NodeRun, log writes
  cleanup-run.ts          # reads from WorkflowRun.orgId once at start
  merge-worktree.ts       # input.orgId → log writes
  copy-conduit-files.ts   # input.orgId → log writes

apps/worker/src/runtime/
  log-writer.ts           # writeAgentEventLog / writeSystemLog (orgId param)
  ticket-branch-store.ts  # upsert reads orgId from input

packages/agent/src/workspace/
  types.ts                # WorkspaceResolveInput.orgId, TicketBranchStore.upsert input
  ticket-branch.ts        # threads orgId into store.upsert
```
