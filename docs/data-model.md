# Data Model

Prisma schema spec for Conduit.

## Principles

- **Nodes live inside `Workflow.definition` JSON** (single source of truth, version-able, no join gymnastics). Persist per-run state per-node via `NodeRun`.
- **Credentials and connections split cleanly.** `Credential` (rotatable token) is one row per platform secret. `Connection` (named, typed binding) sits on top — one Credential can back many Connections (e.g. one PAT bound to a repo *and* a Projects v2 board → two `Connection` rows pointing at one `Credential`). Workflows reference connections by id from inside `Workflow.definition`. See [design-docs/connections.md](./design-docs/connections.md).
- **Webhook secret lives on `Workflow`**, not on a connection. There's exactly one webhook URL per workflow (`POST /api/hooks/:workflowId`); the row that authenticates the inbound request is the workflow itself.
- **`ExecutionLog`** for audit + live streaming replay.
- **`TicketBranch`** is a naming cache for persistent `ticket-branch` workspaces — the branch state itself lives on the remote; this table just stores the stable slug so iteration N+1 finds the same branch as iteration N.
- **Every business-data row carries `orgId`.** `Workflow`, `Connection`, `Credential`, `ProviderConfig`, `WorkflowRun`, `NodeRun`, `ExecutionLog`, `PollSnapshot`, `TicketBranch`, and `RepoAnalysis` all have a non-nullable `orgId String` FK to `Organization.id`. Reads filter by it; writes stamp it. The column is denormalized onto every leaf row (NodeRun → WorkflowRun → Workflow could be joined, but the explicit `orgId` lets a missed filter fail closed instead of leaking sibling-org rows). See [tenant partitioning](#tenant-partitioning--orgid) below.
- **`db:push` during dev**, migrations once schema stabilizes. Schema additions like `orgId` ship empty-DB-only — `npm run db:reset` is the path forward for anyone with existing dev data.

## Models

**`packages/database/prisma/schema.prisma` is the source of truth.** Every model and field carries an inline comment there — read the schema directly for column-level detail (types, defaults, nullability, indexes, enum members). This doc does **not** mirror it; reproducing it in prose only drifts (it already had). What follows is the map you can't read off the schema: which models are tenant-scoped, and the invariants Postgres can't express.

### Tenant-scoped business models

Eleven models carry a non-nullable `orgId String` FK to `Organization.id` (cascade-delete from the org). These are Conduit's business data; everything else is Better Auth or the audit log.

| Model | What it holds | `orgId` source |
|---|---|---|
| `Workflow` | Top-level user config. `definition` JSON holds triggers/nodes/edges/mcpServers/ui; `webhookSecret` + `temporalSlug` live here too. `kind` (`STANDARD`/`SYSTEM`) discriminates user workflows from the per-org hidden host for analysis runs — see [repo-analysis.md](./design-docs/repo-analysis.md). | stamped on create |
| `Credential` | Rotatable platform secret (e.g. GitHub PAT), encrypted at rest. One row per token; rotation propagates to every Connection. `hostUrl` set once for VCS platforms. | stamped on create |
| `Connection` | Named, typed binding over a Credential — the unit a workflow references. `scope` JSON is the Zod discriminated union from `@conduit/shared/connection`. | must equal `Credential.orgId` |
| `ProviderConfig` | Per-org agent provider API key (`claude`/`codex`), consumed by the runtime — never bound to a Connection. At most one row per `(orgId, providerId)`. | stamped on create |
| `ModelPrice` | Per-org pricing override for a specific model (`inputPerM`/`outputPerM` in USD). Unique key is `(orgId, model)` — looked up with a single `findUnique` at node completion. Absent rows fall back to the shipped `MODEL_PRICING` defaults in `@conduit/shared`. Drives `costUsd`/`priceSnapshot` on `NodeRun` for Codex nodes (Claude reports its own cost; see [agent-execution.md](./design-docs/agent-execution.md#runagentnode-lifecycle)). Decoupled from `ProviderConfig` — an org can override prices even when running off an env-var API key. | stamped on create |
| `PollSnapshot` | One row per polling workflow; last-poll matching IDs for diff-based dedup. Overwritten each cycle. | copied from `Workflow.orgId` |
| `TicketBranch` | Naming cache for `ticket-branch` workspaces — keeps the slug stable across runs. Unique key is 6 columns: `(orgId, platform, hostUrl, owner, repo, ticketId)`. | stamped on create |
| `WorkflowRun` | One row per run; status, normalized trigger, Temporal handles. | copied from `Workflow.orgId` |
| `NodeRun` | One row per node per run; final state + usage. Real output lives in `.conduit/<NodeName>.md` (snapshotted into `conduitSummary` at run end). | copied from `WorkflowRun.orgId` |
| `ExecutionLog` | Append-only, high-volume — one row per `AgentEvent`/system event. | copied from `WorkflowRun.orgId` |
| `RepoAnalysis` | One row per analysis of a repo `Connection` — owns the user-facing `status`/`phase` lifecycle and the resulting suggestion bundle. `internalRunId` is a plain `String` (not an FK relation) pointing at the hidden internal run. Latest row per connection drives the badge + gallery. See [repo-analysis.md](./design-docs/repo-analysis.md). | must equal `Connection.orgId` |

The `Platform` enum (`GITHUB`/`GITLAB`/`JIRA`/`SLACK`/`DISCORD`) is the superset Conduit stores credentials for; `TriggerEvent.source` is the trigger-capable subset. See [tenant partitioning](#tenant-partitioning--orgid) below for the enforcement model.

### Invariants the schema can't express

- **Same-org across derived rows.** Every `orgId` copy above must match its parent (`Connection`↔`Credential`, `WorkflowRun`↔`Workflow`, `NodeRun`/`ExecutionLog`/`PollSnapshot`↔their parent). Nothing in Postgres enforces this — the writer does. See the [same-org invariant](#tenant-partitioning--orgid).
- **Connection ids inside `Workflow.definition`** (`triggers[].connectionId`, `triggers[].boardConnectionId`, `mcpServers[].connectionId`) must point at Connections in the same org as the Workflow. The API validators reject cross-org references as 404.
- **`Workflow.definition` is JSON, not rows** — see [Why definition lives in JSON](#why-definition-lives-in-json-not-rows). Shape is Zod-validated in `@conduit/shared`; `triggers` length is 1 in v1.
- **`temporalSlug` is write-once** (`null → value` on first schedule/run materialization), then read-only. The immutable cuid stays the sole determinism anchor. See design-docs/temporal-id-slug.md.
- **`NodeRun.@@unique([runId, nodeName])`** — `nodeName` matches `definition.nodes[i].name`, making node state idempotently upsertable across activity retries.

## Better Auth tables

Conduit embeds [Better Auth](https://better-auth.com/) for sign-up / sign-in / sessions. The `User` / `Session` / `Account` / `Verification` / `Organization` / `Member` / `Invitation` models in `schema.prisma` were generated by `npx @better-auth/cli generate` against `apps/api/src/auth/auth.config.ts` (Better Auth core + `organization` plugin) and pasted in verbatim. Better Auth populates them itself — **Conduit business code never reads or writes them directly**; go through the `auth` instance exposed via `AuthModule` (`apps/api/src/auth/`). See [design-docs/auth-integration.md](./design-docs/auth-integration.md).

`Organization` carries back-relations to all ten tenant-scoped models above, so deleting an org cascade-deletes its business data (org deletion is gated by the `organization` plugin in v1). `Account` holds the OAuth access token that the credential mirror reads (see [connections.md > OAuth-derived credentials](./design-docs/connections.md#oauth-derived-credentials)).

`session.activeOrganizationId` (contributed by the `organization` plugin) is the only field of these tables that Conduit code touches — the `@OrgId()` decorator reads it off `req.session` (see [tenant-partitioning.md](./design-docs/tenant-partitioning.md)). The `organization` plugin keeps it consistent: `setActiveOrganization` only allows orgs the user is a member of, so the value is trusted end-to-end without per-request membership re-checks.

## AuditLog — security event log

See `schema.prisma` for columns. `AuditLog` is a single Prisma table written by `apps/api/src/auth/audit-log.service.ts` from Better Auth `hooks.after` middleware (auth events) and the `organization` plugin's typed `organizationHooks` (org / member / invitation events). It is **append-only at the application layer** — no `update` / `delete` from app code. Operators retain SQL access for retention and GDPR redaction.

**Deliberate FK divergence.** `actorUserId` / `orgId` / `targetUserId` are plain `String?` columns, not `@relation` fields. This breaks the FK convention that every other tenant-scoped row follows, and the divergence is the point. Audit rows are not operational data — their value is "this was true at write time and nothing can change that," which is exactly what FK relations + cascade rules undermine. A future migration changing `onDelete: SetNull` to `Cascade` would silently rewrite history; the no-FK shape forecloses that. The trade-off is no DB-level integrity check on the linkage and joins via raw `LEFT JOIN audit.actorUserId = user.id` rather than Prisma relations — acceptable for a write-mostly table that's queried from operator tools, not from the app's hot paths.

The closed event taxonomy and per-event metadata shape live in `apps/api/src/auth/audit-events.ts` (referenced from [SECURITY.md > Operational hardening](./SECURITY.md#operational-hardening-v1) and [design-docs/operational-hardening.md](./design-docs/operational-hardening.md)).

## How `Workflow.definition` references connections

Triggers carry two named slots, both ids into the `Connection` table:

- `connectionId` (required) — the source binding. A repo-scoped Connection: `github_repo` or `gitlab_project`.
- `boardConnectionId` (optional) — a `github_projects_v2`-scoped Connection. Under `type: 'issues'`, presence is the board-vs-repo dispatch signal (attached → board path, unset → repo path). Under `type: 'webhook'` + `event: 'board.column.changed'`, it's required by the validator. Under `type: 'pull_requests'`, it's allowed but ignored.

`mcpServers[].connectionId` (optional) is also a Connection id; the runtime decrypts the linked `Credential.secret` and substitutes `{{credential}}` in the MCP transport before handing it to the SDK.

Cross-kind validation (e.g. a `boardConnectionId` whose Connection is `github_repo`) happens at the API layer — the validator only sees ids; the connection lookup happens in `CredentialsService.getConnectionBinding` and the worker's `connection-context.ts`. See [design-docs/connections.md](./design-docs/connections.md).

## Why definition lives in JSON, not rows

Pros:
- One atomic write to save a workflow — no dance of "upsert nodes, delete removed ones, update edges."
- Trivial versioning (can add a `definitionHistory` Json[] field later).
- Zod schema in `@conduit/shared` is the *only* source of truth for shape.
- No join queries to render the canvas.

Cons:
- Can't query "show me all workflows using the `github.merge` tool" with SQL. Mitigation: add a denormalized `toolsUsed String[]` on `Workflow` if/when needed.
- Can't query "show me all workflows referencing connection X" with SQL — `ConnectionsService.delete` scans every workflow's definition to enforce delete-protection. Fine at v1 scale; partition the search if it shows up in profiles.
- Larger row size. Fine for realistic workflow sizes (< 50 nodes).

## NodeRun vs. ExecutionLog

- **`NodeRun`** — one row per node per run. Final state. Query for "did this node finish, what files did it change." Small table. The agent's prose summary lives in `.conduit/<NodeName>.md` in the workspace (ephemeral, not persisted in DB).
- **`ExecutionLog`** — one row per `AgentEvent`. Append-only, high volume. Query for "replay what this node did step by step."

The run history page uses `NodeRun` for per-node status; the run detail page uses `ExecutionLog` for the live trace timeline.

## Indexes

- `WorkflowRun(workflowId, startedAt)` — list recent runs for a workflow
- `WorkflowRun(status)` — "show me failing runs" view
- `WorkflowRun(orgId, startedAt)` — list recent runs across an org (billing prep, future per-org dashboards)
- `NodeRun(runId)` — load all nodes for a run
- `ExecutionLog(runId, ts)` — chronological replay
- `ExecutionLog(runId, nodeName, ts)` — per-node timeline view
- `Workflow(isActive)` — boot-time poll-schedule reconciler (cross-org pass)
- `Workflow(orgId, isActive)` — "list active workflows in my org"
- `Credential(platform)` — list credentials by platform
- `Credential(orgId, createdAt)` — "list credentials in my org" (newest first)
- `Connection(credentialId)` — load all connections backed by a credential
- `Connection(orgId, createdAt)` — "list connections in my org" (newest first)
- `TicketBranch(orgId, platform, hostUrl, owner, repo, ticketId)` unique — within-org lookup at `ticket-branch` workspace resolve. Key was `(platform, owner, repo, ticketId)` pre-partitioning; the orgId prefix prevents cross-org slug collisions and `hostUrl` keeps same-named repos on different VCS instances distinct.
- `TicketBranch(platform, owner, repo)` — "list all conduit/* branches Conduit has created for this repo" (no orgId filter; useful for cross-org diagnostics)

## Tenant partitioning — `orgId`

Every business-data row carries `orgId String` (FK to `Organization.id`, non-nullable, cascade-delete from the org). The ten tenant-scoped models are: `Workflow`, `Connection`, `Credential`, `ProviderConfig`, `WorkflowRun`, `NodeRun`, `ExecutionLog`, `PollSnapshot`, `TicketBranch`, `RepoAnalysis`.

**Same-org invariant.** The writer is responsible for keeping derived rows in the same org as their parent:

- `Connection.orgId == Credential.orgId` (Connection.create + template-apply enforce).
- Every `Connection` id referenced inside `Workflow.definition.triggers[].connectionId`, `triggers[].boardConnectionId`, and `mcpServers[].connectionId` must point at a `Connection` in the same org as the `Workflow`. The API validators reject cross-org references as 404.
- `WorkflowRun.orgId == Workflow.orgId` (`WorkflowsService.startRun` and `pollBoardActivity` both copy from the loaded workflow row).
- `NodeRun.orgId == WorkflowRun.orgId` (`runAgentNode` activity copies from the run input).
- `ExecutionLog.orgId == WorkflowRun.orgId` (`writeAgentEventLog` / `writeSystemLog` take orgId as an explicit parameter).
- `PollSnapshot.orgId == Workflow.orgId` (`pollBoardActivity` copies on upsert).
- `RepoAnalysis.orgId == Connection.orgId` (`ConnectionAnalysisService.analyze` stamps from the resolved connection; the hosting internal `WorkflowRun` FKs to the same-org SYSTEM `Workflow`).

Nothing in Postgres enforces these — the responsibility lives in the API services and worker activities.

**Enforcement details live in [tenant-partitioning.md](./design-docs/tenant-partitioning.md).** That doc owns the full story: the explicit-`orgId`-parameter style (why not CLS / Prisma extension), the `@OrgId()` decorator, how worker activities chain `orgId` through loaded rows, the deliberately-unscoped helpers, and the index rationale. The cross-org **404-not-403** convention and the `activeOrganizationId` trust contract are covered there and in [authorization-enforcement.md](./design-docs/authorization-enforcement.md). The points below are the ones a reader of *this* doc needs in place.

**Signup shim.** A single `databaseHooks.session.create.before` hook (`ensurePersonalOrgFor` in `apps/api/src/auth/auth.config.ts`) creates a personal org on first sign-in and stamps `activeOrganizationId` onto the new session row, so the very first authenticated request resolves through `@OrgId()`. There is **no** `user.create.after` hook — running org-create after the session row is inserted would persist `activeOrganizationId = null` and 403 the first request. The full mechanism — plus the hosted invitation gate (`user.create.before`) and the org switcher — lives in [tenant-partitioning.md](./design-docs/tenant-partitioning.md).

**Migration.** Empty-DB-only via `db push`. The schema marks `orgId` `NOT NULL` on day one; anyone with existing dev data resolves it via `npm run db:reset`. No backfill ships.
