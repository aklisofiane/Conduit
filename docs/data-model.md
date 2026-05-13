# Data Model

Prisma schema spec for Conduit.

## Principles

- **Nodes live inside `Workflow.definition` JSON** (single source of truth, version-able, no join gymnastics). Persist per-run state per-node via `NodeRun`.
- **Credentials and connections split cleanly.** `Credential` (rotatable token) is one row per platform secret. `Connection` (named, typed binding) sits on top — one Credential can back many Connections (e.g. one PAT bound to a repo *and* a Projects v2 board → two `Connection` rows pointing at one `Credential`). Workflows reference connections by id from inside `Workflow.definition`. See [design-docs/connections.md](./design-docs/connections.md).
- **Webhook secret lives on `Workflow`**, not on a connection. There's exactly one webhook URL per workflow (`POST /api/hooks/:workflowId`); the row that authenticates the inbound request is the workflow itself.
- **`ExecutionLog`** for audit + live streaming replay.
- **`TicketBranch`** is a naming cache for persistent `ticket-branch` workspaces — the branch state itself lives on the remote; this table just stores the stable slug so iteration N+1 finds the same branch as iteration N.
- **Every business-data row carries `orgId`.** `Workflow`, `Connection`, `Credential`, `WorkflowRun`, `NodeRun`, `ExecutionLog`, `PollSnapshot`, and `TicketBranch` all have a non-nullable `orgId String` FK to `Organization.id`. Reads filter by it; writes stamp it. The column is denormalized onto every leaf row (NodeRun → WorkflowRun → Workflow could be joined, but the explicit `orgId` lets a missed filter fail closed instead of leaking sibling-org rows). See [tenant partitioning](#tenant-partitioning--orgid) below.
- **`db:push` during dev**, migrations once schema stabilizes. Schema additions like `orgId` ship empty-DB-only — `npm run db:reset` is the path forward for anyone with existing dev data.

## Models

```prisma
model Workflow {
  id          String   @id @default(cuid())
  orgId       String   // tenant scope — every read filters; every write stamps. FK to Organization.id.
  name        String
  description String?
  definition  Json     // { triggers: TriggerConfig[], nodes: AgentConfig[], edges: Edge[], mcpServers: WorkflowMcpServer[], ui: CanvasUI } — see @conduit/shared types. triggers length === 1 in v1.
  isActive    Boolean  @default(true)
  // Webhook signing secret for `POST /api/hooks/:workflowId`. Encrypted at
  // rest (AES-256-GCM, same format as Credential.secret). Nullable —
  // polling-only workflows don't need one. See SECURITY.md.
  webhookSecret String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  organization  Organization  @relation(fields: [orgId], references: [id], onDelete: Cascade)
  runs          WorkflowRun[]
  pollSnapshot  PollSnapshot?

  @@index([isActive])
  @@index([orgId, isActive])
}

// A rotatable platform secret (e.g. a GitHub PAT). One row per token.
// Rotation updates `secret` in place and propagates to every Connection
// that references it.
model Credential {
  id        String   @id @default(cuid())
  orgId     String
  platform  Platform
  name      String
  // Encrypted at rest (AES-256-GCM). See SECURITY.md.
  secret    String
  metadata  Json?    // scopes, expiry, etc.
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  organization Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  connections  Connection[]

  @@index([platform])
  @@index([orgId, createdAt])
}

// A named, typed binding on top of a Credential — the unit a workflow
// actually references. `scope` is a Zod-validated discriminated union
// (see @conduit/shared/connection); Prisma stores it as JSON.
//
//   { kind: 'github_repo', owner, repo }
//   { kind: 'github_projects_v2', ownerType, owner, number }
//   { kind: 'none' }
//
// Same-org invariant: Connection.orgId must equal Credential.orgId. Enforced
// by the writer (`ConnectionsService.create` and template-apply); cross-org
// `credentialId` references resolve as 404, never 403.
model Connection {
  id           String   @id @default(cuid())
  orgId        String
  credentialId String
  name         String
  scope        Json
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  organization Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  credential   Credential   @relation(fields: [credentialId], references: [id])

  @@index([credentialId])
  @@index([orgId, createdAt])
}

// Covers all platforms Conduit integrates with — both trigger sources (GitHub, GitLab, Jira)
// and credential-only platforms (Slack, Discord). TriggerEvent.source is the subset that can
// trigger workflows; Platform is the superset used for credential storage.
enum Platform {
  GITHUB
  GITLAB
  JIRA
  SLACK
  DISCORD
}

// One row per polling-mode workflow. Overwritten each poll cycle within a transaction.
// Created on first poll, deleted on workflow delete (cascade). No history — just the last state.
// The poll activity diffs current matching IDs against this snapshot to find new entries.
model PollSnapshot {
  id           String   @id @default(cuid())
  orgId        String   // copied from the parent Workflow.orgId by the poll activity.
  workflowId   String   @unique    // one snapshot per workflow
  matchingIds  Json     // string[] — issue IDs that matched on last poll
  polledAt     DateTime @default(now())

  workflow     Workflow     @relation(fields: [workflowId], references: [id], onDelete: Cascade)
  organization Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
}

// One row per (orgId, platform, repo, ticket) that has been touched by a `ticket-branch` workflow.
// Purely a naming cache — the branch itself lives on the remote. Keeps the slug stable
// across runs even if the ticket title is edited later. Shared across workflows
// **within an org**: a Worker and a Critic targeting the same ticket converge on
// one row. Two orgs working the same Github repo / ticket get distinct rows
// (and distinct slugs derived independently). See docs/design-docs/branch-management.md.
model TicketBranch {
  id         String    @id @default(cuid())
  orgId      String
  platform   Platform
  owner      String    // repo owner/org
  repo       String    // repo name
  ticketId   String    // populated from TriggerEvent.issue.key — user-visible identifier as a string ("42" for GitHub, "PROJ-123" for Jira). Never the opaque issue.id.
  slug       String    // derived from ticket title at first creation — kebab-case, truncated
  branchName String    // stored verbatim: conduit/<ticketId>-<slug>
  baseRef    String?   // base ref used at branch creation (informational; defaults to repo default branch)
  createdAt  DateTime  @default(now())
  lastRunAt  DateTime?

  organization Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@unique([orgId, platform, owner, repo, ticketId])
  @@index([platform, owner, repo])
}

model WorkflowRun {
  id           String      @id @default(cuid())
  orgId        String      // copied from Workflow.orgId at run-start.
  workflowId   String
  status       RunStatus   @default(PENDING)
  trigger      Json        // normalized TriggerEvent
  startedAt    DateTime    @default(now())
  finishedAt   DateTime?
  error        String?
  // Temporal handles: populated when the run is started
  temporalWorkflowId String?
  temporalRunId      String?

  workflow     Workflow       @relation(fields: [workflowId], references: [id], onDelete: Cascade)
  organization Organization   @relation(fields: [orgId], references: [id], onDelete: Cascade)
  nodes        NodeRun[]
  logs         ExecutionLog[]

  @@index([workflowId, startedAt])
  @@index([status])
  @@index([orgId, startedAt])
}

// WorkflowRun transitions: PENDING (row created) → RUNNING (Temporal workflow started) → COMPLETED | FAILED | CANCELLED.
// NodeRun transitions: PENDING (graph loaded) → RUNNING (activity started) → COMPLETED | FAILED | CANCELLED.
enum RunStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
}

model NodeRun {
  id           String      @id @default(cuid())
  orgId        String      // copied from WorkflowRun.orgId at upsert time.
  runId        String
  nodeName     String      // matches definition.nodes[i].name
  nodeType     NodeType
  status       RunStatus   @default(PENDING)
  startedAt    DateTime?
  finishedAt   DateTime?
  output       Json?       // { files?, workspacePath, head?, workspaceKind?, isBranchedWorktree? } — lightweight; real output is .conduit/<NodeName>.md
  error        String?
  // Provider usage summary (agent nodes only)
  usage        Json?       // { inputTokens, outputTokens, toolCalls, turns }
  workspacePath String?    // populated if inherited downstream
  conduitSummary String?   // snapshot of .conduit/<nodeName>.md at run end (freeform markdown; survives workspace cleanup)

  run          WorkflowRun  @relation(fields: [runId], references: [id], onDelete: Cascade)
  organization Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@unique([runId, nodeName])
  @@index([runId])
}

enum NodeType {
  TRIGGER
  AGENT
}

model ExecutionLog {
  id        String   @id @default(cuid())
  orgId     String   // copied from WorkflowRun.orgId at write time.
  runId     String
  nodeName  String?
  ts        DateTime @default(now())
  level     LogLevel @default(INFO)
  // One row per AgentEvent or system event. Kept narrow for fast append.
  kind      ExecutionLogKind
  payload   Json

  run          WorkflowRun  @relation(fields: [runId], references: [id], onDelete: Cascade)
  organization Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@index([runId, ts])
  @@index([runId, nodeName, ts])
}

enum ExecutionLogKind {
  TEXT
  TOOL_CALL
  TOOL_RESULT
  USAGE
  SYSTEM
}

enum LogLevel {
  DEBUG
  INFO
  WARN
  ERROR
}
```

## Better Auth tables

Conduit embeds [Better Auth](https://better-auth.com/) for sign-up / sign-in / sessions. The fragment below was generated by `npx @better-auth/cli generate` against `apps/api/src/auth/auth.config.ts` (Better Auth core + `organization` plugin) and pasted into `schema.prisma` verbatim. Better Auth populates these tables itself — **Conduit business code never reads or writes them directly**; go through the `auth` instance exposed via `AuthModule` (`apps/api/src/auth/`). See [design-docs/auth-integration.md](./design-docs/auth-integration.md).

```prisma
model User {
  id            String       @id
  name          String
  email         String
  emailVerified Boolean      @default(false)
  image         String?
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt
  sessions      Session[]
  accounts      Account[]
  members       Member[]
  invitations   Invitation[]

  @@unique([email])
  @@map("user")
}

model Session {
  id                   String   @id
  expiresAt            DateTime
  token                String   @unique
  userId               String
  activeOrganizationId String?  // contributed by the organization plugin
  ipAddress            String?
  userAgent            String?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("session")
}

model Account {
  id                    String    @id
  accountId             String
  providerId            String
  userId                String
  // OAuth tokens populated when the account is a social provider; password is
  // populated for email/password (hashed by Better Auth).
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("account")
}

model Verification {
  id         String   @id
  identifier String  // email-verification / password-reset token target
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([identifier])
  @@map("verification")
}

model Organization {
  id        String   @id
  name      String
  slug      String   @unique
  logo      String?
  metadata  String?
  createdAt DateTime

  members     Member[]
  invitations Invitation[]

  @@map("organization")
}

model Member {
  id             String   @id
  organizationId String
  userId         String
  role           String   @default("member")
  createdAt      DateTime

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([userId])
  @@map("member")
}

model Invitation {
  id             String   @id
  organizationId String
  email          String
  role           String?
  status         String   @default("pending")
  expiresAt      DateTime
  inviterId      String
  createdAt      DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [inviterId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([email])
  @@map("invitation")
}
```

`session.activeOrganizationId` is the only field of these tables that Conduit code touches — `data-model-partitioning`'s `@OrgId()` decorator reads it off `req.session` once that sub-feature lands. The `organization` plugin keeps it consistent: `setActiveOrganization` only allows orgs the user is a member of, so the value is trusted end-to-end without per-request membership re-checks.

## AuditLog — security event log

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

`AuditLog` is a single Prisma table written by `apps/api/src/auth/audit-log.service.ts` from Better Auth `hooks.after` middleware (auth events) and the `organization` plugin's typed `organizationHooks` (org / member / invitation events). It is **append-only at the application layer** — no `update` / `delete` from app code. Operators retain SQL access for retention and GDPR redaction.

**Deliberate FK divergence.** `actorUserId` / `orgId` / `targetUserId` are plain `String?` columns, not `@relation` fields. This breaks the FK convention that every other tenant-scoped row follows, and the divergence is the point. Audit rows are not operational data — their value is "this was true at write time and nothing can change that," which is exactly what FK relations + cascade rules undermine. A future migration changing `onDelete: SetNull` to `Cascade` would silently rewrite history; the no-FK shape forecloses that. The trade-off is no DB-level integrity check on the linkage and joins via raw `LEFT JOIN audit.actorUserId = user.id` rather than Prisma relations — acceptable for a write-mostly table that's queried from operator tools, not from the app's hot paths.

The closed event taxonomy and per-event metadata shape live in `apps/api/src/auth/audit-events.ts` (referenced from [SECURITY.md > Operational hardening](./SECURITY.md#operational-hardening-v1) and [design-docs/operational-hardening.md](./design-docs/operational-hardening.md)).

## How `Workflow.definition` references connections

Triggers carry two named slots, both ids into the `Connection` table:

- `connectionId` (required) — the source binding. Today: a `github_repo`-scoped Connection.
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
- `TicketBranch(orgId, platform, owner, repo, ticketId)` unique — within-org lookup at `ticket-branch` workspace resolve. Key was `(platform, owner, repo, ticketId)` pre-partitioning; the orgId prefix prevents cross-org slug collisions.
- `TicketBranch(platform, owner, repo)` — "list all conduit/* branches Conduit has created for this repo" (no orgId filter; useful for cross-org diagnostics)

## Tenant partitioning — `orgId`

Every business-data row carries `orgId String` (FK to `Organization.id`, non-nullable, cascade-delete from the org). The eight tenant-scoped models are: `Workflow`, `Connection`, `Credential`, `WorkflowRun`, `NodeRun`, `ExecutionLog`, `PollSnapshot`, `TicketBranch`.

**Same-org invariant.** The writer is responsible for keeping derived rows in the same org as their parent:

- `Connection.orgId == Credential.orgId` (Connection.create + template-apply enforce).
- Every `Connection` id referenced inside `Workflow.definition.triggers[].connectionId`, `triggers[].boardConnectionId`, and `mcpServers[].connectionId` must point at a `Connection` in the same org as the `Workflow`. The API validators reject cross-org references as 404.
- `WorkflowRun.orgId == Workflow.orgId` (`WorkflowsService.startRun` and `pollBoardActivity` both copy from the loaded workflow row).
- `NodeRun.orgId == WorkflowRun.orgId` (`runAgentNode` activity copies from the run input).
- `ExecutionLog.orgId == WorkflowRun.orgId` (`writeAgentEventLog` / `writeSystemLog` take orgId as an explicit parameter).
- `PollSnapshot.orgId == Workflow.orgId` (`pollBoardActivity` copies on upsert).

Nothing in Postgres enforces these — the responsibility lives in the API services and worker activities.

**Cross-org behavior is 404, not 403.** A client that knows another org's row id (workflow, run, connection, credential, etc.) and references it through any of the API services gets `NotFoundException`, never `ForbiddenException`. We don't confirm the existence of cross-org rows. The same convention applies to template-apply bindings (`credentialId`, `connectionId`).

**Enforcement style — explicit `orgId` parameter.** Every API service method that reads or writes a tenant-scoped row takes `orgId: string` as its first business argument and chains it into every `where` / `data` clause. The orgId comes from the controller via `@OrgId()` (apps/api/src/auth/org-id.decorator.ts), which reads `req.session.activeOrganizationId` (set by Better Auth's `organization` plugin) and throws `ForbiddenException` if absent. No `nestjs-cls`, no Prisma client extension. Reasons:

- Worker activities have no request context — Temporal runs them on raw functions with `prisma()` and a `runId`. A CLS-based extension wouldn't apply there, so we'd need an explicit-parameter path either way; one style across both apps is strictly simpler.
- Tests instantiate services directly without an HTTP request, so a CLS extension would silently scope-to-undefined; the explicit parameter avoids that.
- Greppable at every call site.

**Worker chains `orgId` through the loaded row.** `loadGraphActivity` reads `Workflow.orgId` and threads it through `LoadedGraph.orgId` to the agent workflow, which forwards it to `runAgentNode`, `mergeWorktreeActivity`, and `copyConduitFilesActivity`. `pollBoardActivity` reads `wf.orgId` directly and stamps it onto the new `WorkflowRun` and `PollSnapshot`. `cleanupRunActivity` reads `WorkflowRun.orgId` for its log writes. The worker is server-trusted code — no auth context, just a value flowing from row to row.

**Unscoped helpers (deliberate).** A handful of code paths run cross-org by design: `WorkflowsService.reconcilePollSchedules` (boot-time, no caller user); `CredentialsService.decryptForConnection` and `getConnectionBinding` (server-trusted, called from worker / config helpers that already authorized against the workflow row); `TemplatesService.list` / `.get` (Conduit-shipped global content); `WebhooksController` (HMAC-authenticated, takes `Workflow.orgId` from the loaded workflow row before forwarding to `startRun`).

**Signup shim.** `apps/api/src/auth/auth.config.ts` extends Better Auth with two `databaseHooks`:

- `user.create.after`: calls `auth.api.createOrganization` with the new user's id; produces a personal org named "<email-localpart>'s workspace" with a randomized slug suffix.
- `session.create.before`: looks up the user's first `Member` row and sets `session.activeOrganizationId` so the very first request after signup resolves through `@OrgId()` without an extra round-trip.

Polished naming, the org switcher, members management, and invitations all live in the `org-on-signup-and-switching` sub-feature.

**Migration.** Empty-DB-only via `db push`. The schema marks `orgId` `NOT NULL` on day one; anyone with existing dev data resolves it via `npm run db:reset`. No backfill ships.
