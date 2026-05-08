# Architecture

## High-level

```
┌──────────────┐   webhook    ┌──────────────┐   Temporal    ┌────────────────┐
│ GitHub/etc.  │─────────────▶│   API (Nest) │──────────────▶│  Worker (TS)   │
└──────────────┘              └──────┬───────┘  start run    │  orchestrator  │
                                     │                       └──────┬─────────┘
                                     │ WS /runs                     │ docker run --rm
                                     ▼                              ▼  (per agent node)
                              ┌──────────────┐              ┌──────────────────┐
                              │  Web (React) │◀── Redis ────│  agent-runner    │
                              │    canvas    │   pub/sub    │  container       │
                              └──────────────┘     ▲        │  @conduit/agent  │
                                                   │        │  + Claude/Codex  │
                                                   │stdout  │  + MCP servers   │
                                                   │JSON-lines───────┬─────────┘
                                                   │                 │
                                                   └── worker forwards each
                                                       RunnerEvent into
                                                       Prisma + Redis
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
| `apps/web` | React 19, Vite 8, `@xyflow/react`, TanStack Query, Zustand, Tailwind v4 + shadcn/ui (New York/Zinc), react-hook-form + Zod | Canvas editor (design only), agent config UI, trigger config UI (webhook / polling mode toggle, stacked Repo + Board connection sub-rows, filter builder), run history + dedicated run detail page with streaming logs |
| `apps/worker` | Temporal TS SDK | Executes `agentWorkflow` — loads nodes, topo sorts, invokes the orchestrator activity per node. The activity spawns a fresh `agent-runner` container, writes a `RunnerRequest` to its stdin, and translates each returned `RunnerEvent` back into Prisma writes + Redis publishes + Temporal heartbeats. Also executes `pollWorkflow` → `pollBoardActivity` when a Temporal Schedule fires — dispatches on the trigger's `mode.scope` / `mode.source` (Projects v2 board, repo issues, or repo PRs), diffs the matching set against `PollSnapshot`, and starts `agentWorkflow`s for new matches. **Provider SDKs no longer live here** — they're baked into the runner image |
| `apps/agent-runner` | `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`, `@conduit/agent` | One short-lived container per agent node. Reads `RunnerRequest` on stdin, drives the provider session (main → optional issue-writeback → final summary turn), streams `AgentEvent`s as JSON lines on stdout, emits a terminal `exit` carrying head/changedFiles/`.conduit/<NodeName>.md`. No DB, no Redis, no master KEK, no other runs' credentials. See [design-docs/agent-execution.md > Runner container model](./design-docs/agent-execution.md#runner-container-model) |

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
| `@conduit/agent` | Agent provider abstraction (`AgentProvider` interface), Claude + Codex providers, workspace manager (`ticket-branch` worktree resolution + parallel-`inherit` branched worktrees + merge-back), MCP config resolution (decrypt credentials, substitute `{{credential}}`, hand to SDK). **Core of the system.** |

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
6. **Agent activity** → resolves the workspace and MCP configs (decrypt credentials, substitute `{{credential}}`), packs everything into a `RunnerRequest`, and `docker run --rm`s a fresh `agent-runner` container. The runner — not the worker — invokes the provider SDK; the SDK spawns/connects MCP servers inside the container. The runner streams `RunnerEvent` lines back to the worker on stdout; the worker translates each `agent` event into a heartbeat + Redis publish on `conduit:run-updates` + Prisma write, exactly the same way it did before the split.
7. **API gateway** (`RunsGateway`) subscribes to Redis, re-emits on Socket.IO `runs` namespace.
8. **Frontend run detail page** (`useRunUpdates`) updates TanStack Query cache; timeline renders live text, tool calls, and usage.

## Temporal workflow (sketch)

```ts
// apps/worker/src/workflows/agent-workflow.ts
export async function agentWorkflow(input: AgentWorkflowInput) {
  const graph = await loadGraphActivity(input.workflowId);
  // Triggers and agents share a name namespace; entry agents are the targets
  // of trigger→agent edges. The topo sort runs over the agent subgraph only,
  // so agents not reachable from any trigger are silently skipped.
  const triggerNames = new Set(graph.triggers.map((t) => t.name));
  const entryNames = graph.edges.filter(e => triggerNames.has(e.from)).map(e => e.to);
  const agentEdges = graph.edges.filter(e => !triggerNames.has(e.from));
  const order = topoSortGroups(graph.nodes, agentEdges, entryNames); // inline, no Node imports

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

All routes prefixed `/api`. Non-webhook routes require a Better Auth session cookie (see [design-docs/auth-integration.md](./design-docs/auth-integration.md)).

### Auth

| Method | Path | Description |
|---|---|---|
| `*`    | `/auth/*` | Better Auth handler (sign-up/sign-in/sign-out/get-session, `organization/*`). Mounted **before** `express.json()` so the handler sees the raw body. |
| `GET`  | `/auth-config` | Public — returns `{ deployment, oauthProviders }`. Drives which login buttons the web UI renders. |

### Workflows

| Method | Path | Description |
|---|---|---|
| `GET` | `/workflows` | List workflows (name, status, last run) |
| `POST` | `/workflows` | Create workflow (400 on `validateWorkflowDefinition` issues — e.g. a webhook trigger that doesn't carry an issue/PR ref) |
| `GET` | `/workflows/:id` | Get workflow with full definition |
| `PUT` | `/workflows/:id` | Update workflow (definition, name, active toggle — same save-time validation as create) |
| `DELETE` | `/workflows/:id` | Delete workflow + cascade runs |

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
| `POST` | `/hooks/:workflowId` | Inbound platform webhook. HMAC-SHA256 verified against `Workflow.webhookSecret` (GitHub: `X-Hub-Signature-256`). Not session-guarded — the platform doesn't carry a session cookie. Normalizes the payload to a `TriggerEvent`, applies filters, starts a run. Returns `200 started | filtered | unsupported | duplicate-dropped` so the platform doesn't retry soft drops; `401` only for auth failures, `404` for unknown workflow. |

### Credentials

| Method | Path | Description |
|---|---|---|
| `GET` | `/credentials` | List `Credential` rows (secrets redacted, with `connectionCount` + suffix) |
| `POST` | `/credentials` | Create a credential (encrypted at rest) |
| `PUT` | `/credentials/:id` | Update credential (rotate secret) — propagates to every Connection that references it |
| `DELETE` | `/credentials/:id` | Delete credential (409 if any Connection references it — detach connections first) |

### Connections

| Method | Path | Description |
|---|---|---|
| `GET` | `/connections` | List `Connection` rows. Optional filters: `?platform=GITHUB`, `?scopeKind=github_repo`. Used by the canvas's trigger Repo / Board pickers and the global Connections page. |
| `GET` | `/connections/:id` | Fetch one connection with its joined credential summary |
| `POST` | `/connections` | Create a connection — `{ credentialId, name, scope }` where `scope` is the typed discriminated union (see [design-docs/connections.md](./design-docs/connections.md)) |
| `PATCH` | `/connections/:id` | Update connection `{ credentialId?, name?, scope? }` |
| `DELETE` | `/connections/:id` | Delete a connection. 409 if any workflow's `definition` JSON references it (trigger or MCP slot) — body lists the blocking workflows. |

### Workflow webhook secret

| Method | Path | Description |
|---|---|---|
| `PUT` | `/workflows/:id/webhook-secret` | Body: `{ secret }`. Encrypts and stores on `Workflow.webhookSecret`. Rotating overwrites — single secret per workflow in v1. |
| `DELETE` | `/workflows/:id/webhook-secret` | Clear the workflow's webhook secret (sets the column to `null`). |

### MCP

| Method | Path | Description |
|---|---|---|
| `POST` | `/mcp/introspect` | Given an MCP server config (with credentials substituted), connect via `@modelcontextprotocol/sdk`, call `tools/list`, return tool metadata. Used at config time to populate the `allowedTools` picker. |

### Trigger config-time helpers

| Method | Path | Description |
|---|---|---|
| `POST` | `/trigger/list-projects` | Body: `{ connectionId, ownerType: 'user' \| 'org', owner }`. Resolves the connection via `CredentialsService.getConnectionBinding`, calls `listProjectBoards` (`@conduit/shared/platform`), returns `ProjectBoardSummary[]` — number, title, url, single-select fields with options. Drives the board dropdown + filter-value dropdowns in the trigger config UI. Bad token / missing scope / unknown owner surface as `400` so the message renders inline next to the input, mirroring `/mcp/introspect`. The web side calls this through `useListProjectBoards` (`useQuery`, keyed on `(connectionId, ownerType, owner)`, 30s `staleTime`). |
| `POST` | `/trigger/list-labels` | Body: `{ connectionId }`. Same binding lookup; the connection must have `scope.kind === 'github_repo'` (400 otherwise) — `owner`/`repo` come from the parsed scope. Calls `listRepoLabels` (`@conduit/shared/platform`); returns `RepoLabel[]`. Drives the **Allowed labels** picker in the agent panel's issue-writeback control — see [agent-execution.md > Issue writeback](./design-docs/agent-execution.md#issue-writeback). The web side calls it via `useListLabels` (30s `staleTime`). |

### Skills

| Method | Path | Description |
|---|---|---|
| `GET` | `/skills` | List discovered skills from repo + worker (name, description, source) |

### Templates

| Method | Path | Description |
|---|---|---|
| `GET` | `/templates` | List workflow templates loaded from `/templates/*.json` at boot — id, name, description, category, `workflowCount`, and the unique `<alias>` connection placeholders the bundle references. Templates that reference an unknown `presetId` are skipped at boot. |
| `GET` | `/templates/:id` | Fetch a single template summary (same shape as list entries). 404 if the id isn't loaded. |
| `POST` | `/workflows/from-template/:templateId` | Create **all** workflows in the template atomically. Body: `{ bindings: Record<alias, Binding> }` where `Binding` is `{ mode: 'existing', connectionId }` or `{ mode: 'new', name, credentialId, scope }` (`scope` is the typed discriminated union — see [design-docs/connections.md](./design-docs/connections.md)). A single Prisma `$transaction` materializes any `new` bindings into `Connection` rows once, then creates N workflow rows with placeholder ids substituted into each `definition`. `validateWorkflowDefinition` runs per workflow inside the transaction, and connection scope-kinds are checked against each placeholder's expected slot kinds. 400 on missing bindings, unknown credential/connection ids, scope-kind mismatch, or post-substitution validation failures. Polling schedules upsert after commit. |

### Agent presets

| Method | Path | Description |
|---|---|---|
| `GET` | `/agent-presets` | List reusable agent prompts loaded from `/agent-presets/*.json` at boot — id, name, category, provider, model, instructions. Drives the canvas agent config panel's preset picker and template `presetId` expansion. See [agent-presets.md](./design-docs/agent-presets.md). |
| `GET` | `/agent-presets/:id` | Fetch one preset by id. 404 if not loaded. |

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
