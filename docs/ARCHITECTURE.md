# Architecture

## High-level

```
┌──────────────┐   webhook    ┌──────────────┐   Temporal    ┌──────────────┐
│ GitHub/etc.  │─────────────▶│   API (Nest) │──────────────▶│  Worker (TS) │
└──────────────┘              └──────┬───────┘  start run    └──────┬───────┘
                                     │                              │
                                     │ WS /runs                     │ invoke agent
                                     ▼                              ▼
                              ┌──────────────┐              ┌──────────────┐
                              │  Web (React) │◀── Redis ────│@conduit/agent│
                              │    canvas    │   pub/sub    │  providers   │
                              └──────────────┘              └──────┬───────┘
                                                                   │
                                                         ┌─────────┴────────┐
                                                         │  Claude / Codex  │
                                                         │  + MCP servers   │
                                                         └──────────────────┘
```

## Tech stack

**Runtime & tooling**
- Node.js 22 (see `.nvmrc`)
- npm workspaces + Turborepo
- TypeScript
- ESLint + Prettier (lint/format)
- Vitest (unit + integration), Playwright (E2E), `@temporalio/testing` (workflow tests)

**Apps**

| App | Stack | Responsibility |
|---|---|---|
| `apps/api` | NestJS 11, Socket.IO, Prisma | Webhook ingestion + signature verify, workflow CRUD, trigger matching, Temporal client, WS gateway for live run updates. Owns polling-trigger `Schedule` lifecycle (create / update / delete on workflow save + boot-time reconcile) via `TemporalService.upsertPollSchedule` |
| `apps/web` | React 19, Vite 8, `@xyflow/react`, TanStack Query, Zustand, Tailwind v4 + shadcn/ui (New York/Zinc), react-hook-form + Zod | Canvas editor (design only), agent config UI, trigger config UI (webhook / polling mode toggle, `BoardRef` fieldset, filter builder), run history + dedicated run detail page with streaming logs |
| `apps/worker` | Temporal TS SDK, `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk` | Executes `agentWorkflow` — loads nodes, topo sorts, invokes agent activity per node, streams updates to Redis. Also executes `pollWorkflow` → `pollBoardActivity` when a Temporal Schedule fires, which diffs the GitHub Projects v2 board against `PollSnapshot` and starts `agentWorkflow`s for new matches |

**Infrastructure (via Docker Compose)**
- Postgres 18 (port 5434)
- Temporal (port 7233) + Temporal UI (port 8080)
- Redis (port 6379)

**Migrations**: `prisma db push` during dev; switch to `prisma migrate` once schema stabilizes (Phase 1 exit).

## Packages

| Package | Responsibility |
|---|---|
| `@conduit/shared` | Types + Zod schemas, plus the cross-process contracts API/worker/web all import (AES-256-GCM crypto, Redis run-updates channel, Temporal task queue name, `AgentEvent → ExecutionLogKind` mapping). `"sideEffects": false` so Vite tree-shakes `node:crypto` out of the web bundle. |
| `@conduit/database` | Prisma schema + `PrismaClient` re-export. See [data-model.md](./data-model.md). |
| `@conduit/agent` | Agent provider abstraction (`AgentProvider` interface), Claude + Codex providers, workspace manager (git worktree seeding, tmpdir sandboxing, persistent branch resolution for `ticket-branch`), MCP config resolution (decrypt credentials, substitute `{{credential}}`, hand to SDK). **Core of the system.** |

## Dependency graph

```
@conduit/shared   ←── api, web, worker, agent
@conduit/database ←── api, worker
@conduit/agent    ←── api, worker   # api uses it for skill discovery
```

## Data flow: webhook → live UI

1. **Webhook arrives** → `POST /api/hooks/:workflowId` → signature verified (HMAC-SHA256).
2. **Event normalized** → platform-specific mapper produces a `TriggerEvent` (stable shape across all platforms). Polling triggers skip steps 1–2 — `pollBoardActivity` synthesizes the `TriggerEvent` directly off the GraphQL response.
3. **Trigger match** → `WebhooksService.matchesTrigger()` compares event against the workflow's trigger config.
4. **Run created** → `WorkflowRun` row in Postgres → Temporal workflow `agentWorkflow` started with `{ workflowId, runId, triggerEvent }`.
5. **Workflow executes** → loads node graph, topo sorts, for each node invokes `runAgentNode` activity. Parallel groups run via `Promise.all`.
6. **Agent activity** → resolves MCP configs (decrypt credentials, substitute `{{credential}}`), invokes the provider with the resolved configs — the SDK spawns/connects the MCP servers. Tool calls, text chunks, and token counts are streamed via heartbeat + Redis pub/sub on `conduit:run-updates`.
7. **API gateway** (`RunsGateway`) subscribes to Redis, re-emits on Socket.IO `runs` namespace.
8. **Frontend run detail page** (`useRunUpdates`) updates TanStack Query cache; timeline renders live text, tool calls, and usage.

## Temporal workflow (sketch)

```ts
// apps/worker/src/workflows/agent-workflow.ts
export async function agentWorkflow(input: AgentWorkflowInput) {
  const graph = await loadGraphActivity(input.workflowId);
  const order = topoSort(graph.nodes, graph.edges);      // inline, no Node imports

  for (const group of order) {                            // group = parallel set
    await Promise.all(group.map(async (node) => {
      const context = buildContext(input.triggerEvent, node, graph);
      await runAgentNode(node, context);
    }));
    // After parallel group: sequentially merge each agent's worktree back
    for (const node of group) {
      if (needsMergeBack(node)) {
        await mergeWorktreeActivity(node, targetBranchFor(node, graph));
      }
    }
    // Copy .conduit/ files from each parallel worktree into target workspace
    await copyConduitFilesActivity(group);
  }
  // Clean up workspaces, worktrees, and .conduit/ folder
  await cleanupRunActivity(input.runId);
}
```

The V8 sandbox constraint still applies: workflow file imports nothing Node-specific. All I/O (Prisma, agent provider, Redis, git, MCP servers) lives in activities.

## API surface

All routes prefixed `/api`. Non-webhook routes require `X-API-Key` header (see [SECURITY.md](./SECURITY.md)).

### Workflows

| Method | Path | Description |
|---|---|---|
| `GET` | `/workflows` | List workflows (name, status, last run) |
| `POST` | `/workflows` | Create workflow (400 on `validateWorkflowDefinition` issues — e.g. `ticket-branch` without an issue-carrying trigger) |
| `GET` | `/workflows/:id` | Get workflow with full definition |
| `PUT` | `/workflows/:id` | Update workflow (definition, name, active toggle — same save-time validation as create) |
| `DELETE` | `/workflows/:id` | Delete workflow + cascade runs |
| `POST` | `/workflows/:id/run` | Manual run — starts a run with optional issue/PR reference. Dev/debug action, not a trigger mode. |

### Runs

| Method | Path | Description |
|---|---|---|
| `GET` | `/workflows/:id/runs` | List runs for a workflow (paginated, filterable by status) |
| `GET` | `/runs/:runId` | Get run detail (status, node statuses, trigger event) |
| `POST` | `/runs/:runId/cancel` | Cancel a running workflow via Temporal |
| `GET` | `/runs/:runId/logs` | Get execution logs for a run (filterable by nodeName, kind) |
| `GET` | `/runs/:runId/logs/:nodeName` | Get execution logs for a specific node |

### Webhooks

| Method | Path | Description |
|---|---|---|
| `POST` | `/hooks/:workflowId` | Inbound platform webhook. HMAC-SHA256 verified against the connection's `webhookSecret` (GitHub: `X-Hub-Signature-256`). Unauthenticated by API key — the platform doesn't carry one. Normalizes the payload to a `TriggerEvent`, applies filters, starts a run. Returns `200 started | filtered | unsupported` so the platform doesn't retry soft drops; `401` only for auth failures, `404` for unknown workflow. |

### Credentials & Connections

| Method | Path | Description |
|---|---|---|
| `GET` | `/credentials` | List platform credentials (secrets redacted) |
| `POST` | `/credentials` | Create a credential (encrypted at rest) |
| `PUT` | `/credentials/:id` | Update credential (rotate secret) |
| `DELETE` | `/credentials/:id` | Delete credential (fails if in use by connections) |
| `GET` | `/workflows/:id/connections` | List connections (secrets redacted — `hasWebhookSecret` + `webhookSecretSuffix` only) |
| `POST` | `/workflows/:id/connections` | Create a connection (alias + credential + optional owner/repo + optional webhook signing secret) |
| `PUT` | `/workflows/:id/connections/:connId` | Update bindings. `webhookSecret: ""` clears it; omitting the field leaves it alone |
| `DELETE` | `/workflows/:id/connections/:connId` | Delete a connection |

### MCP

| Method | Path | Description |
|---|---|---|
| `POST` | `/mcp/introspect` | Given an MCP server config (with credentials substituted), connect via `@modelcontextprotocol/sdk`, call `tools/list`, return tool metadata. Used at config time to populate the `allowedTools` picker. |

### Skills

| Method | Path | Description |
|---|---|---|
| `GET` | `/skills` | List discovered skills from repo + worker (name, description, source) |

### Templates

| Method | Path | Description |
|---|---|---|
| `GET` | `/templates` | List workflow templates loaded from `/templates/*.json` at boot — id, name, description, category, `workflowCount`, and the unique `<alias>` connection placeholders the bundle references. |
| `GET` | `/templates/:id` | Fetch a single template summary (same shape as list entries). 404 if the id isn't loaded. |
| `POST` | `/workflows/from-template/:templateId` | Create **all** workflows in the template atomically. Body: `{ bindings: Record<alias, Binding> }` where `Binding` is `{ mode: 'existing', connectionId }` or `{ mode: 'new', alias, credentialId, owner?, repo?, webhookSecret? }`. A single Prisma `$transaction` inserts N workflow rows + one `WorkflowConnection` per (workflow × `new` binding), substitutes placeholder ids, runs `validateWorkflowDefinition` per workflow, then upserts Temporal poll schedules. 400 on missing bindings, unknown credential/connection ids, or post-substitution validation failures. |

### WebSocket

| Namespace | Event | Description |
|---|---|---|
| `runs/<runId>` | `node-update` | `{ nodeName, event: AgentEvent }` — streamed live from Redis |

## Key conventions

- **Zod in `@conduit/shared`** = single source of truth. Same schemas validate API requests and UI forms.
- **Domain subpath exports from `@conduit/shared`** — consumers import `@conduit/shared/agent`, `/trigger`, `/mcp`, `/workflow`, `/runtime`, `/temporal`, `/workspace`, `/skill`, `/platform` rather than a single barrel, so each app only pulls the schemas it actually uses. The root barrel re-exports those subpaths for convenience; **`/crypto` and `/webhook` are deliberately *not* in the root barrel** — they pull `node:crypto`, which Vite would otherwise drag into the web bundle. Backend-only code imports them via the narrow subpath.
- **Node names are stable identifiers** (user-editable, validated unique within a workflow). Each agent writes `.conduit/<NodeName>.md` in the workspace; downstream agents read the folder for upstream context.
- **Tools are MCP servers.** No custom tool registry. Agent nodes declare which MCP servers to connect to; credentials are injected as env vars when spawning the server process.
- **Vite alias** `@conduit/shared` → `packages/shared/src/index.ts` (no build step during web dev).
- **Single root `.env`**. API/worker read `../../.env`, web uses `VITE_*` prefix, `packages/database/.env` is a copy for Prisma CLI.
