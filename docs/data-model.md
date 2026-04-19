# Data Model

Prisma schema spec for Conduit.

## Principles

- **Nodes live inside `Workflow.definition` JSON** (single source of truth, version-able, no join gymnastics). Persist per-run state per-node via `NodeRun`.
- **Credentials are normalized** — they're reused across workflows and need rotation, so `PlatformCredential` + `WorkflowConnection` are their own tables.
- **`ExecutionLog`** for audit + live streaming replay.
- **`TicketBranch`** is a naming cache for persistent `ticket-branch` workspaces — the branch state itself lives on the remote; this table just stores the stable slug so iteration N+1 finds the same branch as iteration N.
- **`db:push` during dev**, migrations once schema stabilizes.

## Models

```prisma
model Workflow {
  id          String   @id @default(cuid())
  name        String
  description String?
  definition  Json     // { trigger, nodes: Node[], edges: Edge[], mcpServers: WorkflowMcpServer[], ui: CanvasUI } — see @conduit/shared types
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  connections   WorkflowConnection[]
  runs          WorkflowRun[]
  pollSnapshot  PollSnapshot?

  @@index([isActive])
}

model WorkflowConnection {
  id           String @id @default(cuid())
  workflowId   String
  alias        String   // user-facing name, unique within workflow
  credentialId String
  // Platform-specific bindings (nullable — e.g. Slack connection has no repo)
  owner        String?
  repo         String?
  // HMAC signing secret for inbound webhooks on this connection. Encrypted
  // at rest with the same AES-256-GCM format as PlatformCredential.secret.
  // Nullable — polling-only / outbound-only connections don't need one.
  // See SECURITY.md ("Webhook authentication").
  webhookSecret String?

  workflow   Workflow           @relation(fields: [workflowId], references: [id], onDelete: Cascade)
  credential PlatformCredential @relation(fields: [credentialId], references: [id])

  @@unique([workflowId, alias])
}

model PlatformCredential {
  id        String   @id @default(cuid())
  platform  Platform
  name      String
  // Encrypted at rest; see SECURITY.md
  secret    String
  metadata  Json?    // scopes, expiry, etc.
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  connections WorkflowConnection[]
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
  workflowId   String   @unique    // one snapshot per workflow
  matchingIds  Json     // string[] — issue IDs that matched on last poll
  polledAt     DateTime @default(now())

  workflow Workflow @relation(fields: [workflowId], references: [id], onDelete: Cascade)
}

// One row per (platform, repo, ticket) that has been touched by a `ticket-branch` workflow.
// Purely a naming cache — the branch itself lives on the remote. Keeps the slug stable
// across runs even if the ticket title is edited later. Shared across workflows: if
// a Worker workflow and a Critic workflow both target the same ticket on the same repo,
// they resolve to the same row and the same branch name.
// See docs/design-docs/branch-management.md.
model TicketBranch {
  id         String    @id @default(cuid())
  platform   Platform
  owner      String    // repo owner/org
  repo       String    // repo name
  ticketId   String    // populated from TriggerEvent.issue.key — user-visible identifier as a string ("42" for GitHub, "PROJ-123" for Jira). Never the opaque issue.id.
  slug       String    // derived from ticket title at first creation — kebab-case, truncated
  branchName String    // stored verbatim: conduit/<ticketId>-<slug>
  baseRef    String?   // base ref used at branch creation (informational; defaults to repo default branch)
  createdAt  DateTime  @default(now())
  lastRunAt  DateTime?

  @@unique([platform, owner, repo, ticketId])
  @@index([platform, owner, repo])
}

model WorkflowRun {
  id           String      @id @default(cuid())
  workflowId   String
  status       RunStatus   @default(PENDING)
  trigger      Json        // normalized TriggerEvent
  startedAt    DateTime    @default(now())
  finishedAt   DateTime?
  error        String?
  // Temporal handles: populated when the run is started
  temporalWorkflowId String?
  temporalRunId      String?

  workflow Workflow      @relation(fields: [workflowId], references: [id], onDelete: Cascade)
  nodes    NodeRun[]
  logs     ExecutionLog[]

  @@index([workflowId, startedAt])
  @@index([status])
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
  runId        String
  nodeName     String      // matches definition.nodes[i].name
  nodeType     NodeType
  status       RunStatus   @default(PENDING)
  startedAt    DateTime?
  finishedAt   DateTime?
  output       Json?       // { files?: string[], workspacePath: string } — lightweight; real output is .conduit/<NodeName>.md
  error        String?
  // Provider usage summary (agent nodes only)
  usage        Json?       // { inputTokens, outputTokens, toolCalls, turns }
  workspacePath String?    // populated if inherited downstream

  run WorkflowRun @relation(fields: [runId], references: [id], onDelete: Cascade)

  @@unique([runId, nodeName])
  @@index([runId])
}

enum NodeType {
  TRIGGER
  AGENT
}

model ExecutionLog {
  id        String   @id @default(cuid())
  runId     String
  nodeName  String?
  ts        DateTime @default(now())
  level     LogLevel @default(INFO)
  // One row per AgentEvent or system event. Kept narrow for fast append.
  kind      ExecutionLogKind
  payload   Json

  run WorkflowRun @relation(fields: [runId], references: [id], onDelete: Cascade)

  @@index([runId, ts])
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

## Why definition lives in JSON, not rows

Pros:
- One atomic write to save a workflow — no dance of "upsert nodes, delete removed ones, update edges."
- Trivial versioning (can add a `definitionHistory` Json[] field later).
- Zod schema in `@conduit/shared` is the *only* source of truth for shape.
- No join queries to render the canvas.

Cons:
- Can't query "show me all workflows using the `github.merge` tool" with SQL. Mitigation: add a denormalized `toolsUsed String[]` on `Workflow` if/when needed.
- Larger row size. Fine for realistic workflow sizes (< 50 nodes).

## NodeRun vs. ExecutionLog

- **`NodeRun`** — one row per node per run. Final state. Query for "did this node finish, what files did it change." Small table. The agent's prose summary lives in `.conduit/<NodeName>.md` in the workspace (ephemeral, not persisted in DB).
- **`ExecutionLog`** — one row per `AgentEvent`. Append-only, high volume. Query for "replay what this node did step by step."

The run history page uses `NodeRun` for per-node status; the run detail page uses `ExecutionLog` for the live trace timeline.

## Indexes

- `WorkflowRun(workflowId, startedAt)` — list recent runs for a workflow
- `WorkflowRun(status)` — "show me failing runs" view
- `NodeRun(runId)` — load all nodes for a run
- `ExecutionLog(runId, ts)` — chronological replay
- `Workflow(isActive)` — webhook matching loop
- `TicketBranch(platform, owner, repo, ticketId)` unique — lookup at `ticket-branch` workspace resolve
- `TicketBranch(platform, owner, repo)` — "list all conduit/* branches Conduit has created for this repo"
