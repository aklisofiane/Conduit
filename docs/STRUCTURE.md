# Structure

Where things live. Read [ARCHITECTURE.md](./ARCHITECTURE.md) for *why* first; this doc is a map, not an explanation.

## Top-level

```
apps/        runnable services (api, web, worker)
packages/    libraries (shared, database, agent)
docs/        spec — INDEX.md for read order
test/        cross-app test infra (e2e harness, fixtures, helpers)
```

Root configs: `turbo.json`, `tsconfig.base.json`, `vitest.workspace.ts`, `vitest.shared.ts`, `eslint.config.mjs`, `docker-compose.yml`, `docker-compose.test.yml`, `.env`.

## apps/api (NestJS — HTTP + WS)

```
src/
  main.ts, app.module.ts, config.ts   Nest bootstrap
  common/                              API-key guard, Zod body pipe, Prisma service
  redis/, temporal/                    clients shared across modules
  modules/
    workflows/                         workflow CRUD, trigger-match, manual run
    runs/                              run queries + Socket.IO gateway (runs.gateway.ts)
    credentials/                       credential CRUD + AES-256-GCM (crypto.ts)
    mcp/                               POST /mcp/introspect — live tools/list
    skills/                            GET /skills
    health/                            liveness
```

## apps/worker (Temporal)

```
src/
  main.ts, config.ts                   worker bootstrap, registers workflows + activities
  workflows/
    agent-workflow.ts                  sandboxed — NO node:* / Prisma / Redis imports
    topo-sort.ts                       pure graph ordering
  activities/
    run-agent-node.ts                  invokes provider, streams events via heartbeat + Redis
    load-graph.ts, cleanup-run.ts
  runtime/                             activity-side helpers (Prisma, Redis event bus, log writer,
                                       connection/credential lookup)
```

If it touches I/O, it belongs under `activities/` or `runtime/`, never `workflows/`.

## apps/web (React + Vite)

```
src/
  main.tsx, routes/router.tsx
  pages/                               HomePage, CanvasPage, RunDetailPage, CredentialsPage
  components/
    canvas/                            TriggerNode, AgentNode, NodePalette, AgentConfigPanel
    run/RunTimeline.tsx                live log rendering
    layout/, ui/                       shell + shadcn primitives
  api/                                 HTTP client, TanStack Query hooks, response types
  hooks/use-run-updates.ts             Socket.IO → TanStack cache bridge
  state/workflow-editor.ts             Zustand store for the canvas
  lib/                                 cn, status, time helpers
  styles/
```

## packages/shared

Zod schemas + cross-process contracts. Domain directories line up with subpath exports — import `@conduit/shared/agent` etc., not the root barrel.

```
src/
  agent/      AgentEvent, provider contract types
  trigger/    TriggerEvent normalization shapes
  mcp/        MCP server config + tool schemas
  workflow/   Workflow.definition JSON schema (nodes, edges, ui)
  workspace/  workspace kind schemas (local, repo-clone, inherit, ticket-branch)
  skill/      skill manifest types
  platform/   Platform enum + per-platform connection shapes
  runtime/    AgentEvent → ExecutionLogKind mapping, Redis channel name
  temporal/   task queue name, workflow input types
  crypto/     AES-256-GCM helpers
```

## packages/agent

Provider abstraction + workspace + MCP + skills. **Core of the execution path.**

```
src/
  provider/
    types.ts                           AgentProvider interface
    registry.ts                        selected by CONDUIT_PROVIDER env
    claude-provider.ts                 wraps @anthropic-ai/claude-agent-sdk
    stub-provider.ts                   scripted events for tests (real tools, fake LLM)
    constraints.ts
  workspace/
    manager.ts                         top-level orchestration
    git.ts, paths.ts                   worktree seeding, path derivation
    conduit-folder.ts                  .conduit/<NodeName>.md reads/writes
  mcp/resolve.ts                       decrypt credentials + {{credential}} substitution
  skill/                               discovery + install into workspace
  errors/
```

## packages/database

```
prisma/schema.prisma                   source of truth (see docs/data-model.md)
src/index.ts                           re-exports PrismaClient + model types
```

## test/

```
e2e/
  harness.ts                           spins up api + worker + StubProvider + test stack
  stack.ts, global-setup.ts
  phase1-manual-run.test.ts            Phase 1 exit criterion as an E2E
helpers/temporal.ts                    TestWorkflowEnvironment + MockActivityEnvironment wrappers
fixtures/
  workflows/                           seed JSON per topology
  mcp-stub/                            in-repo stdio MCP server for tests
  repos/, events/                      reserved (Phase 2)
```

Per-package unit tests sit next to source (`*.test.ts`); integration tests live under `<package>/test/integration/`; API contract tests under `apps/api/test/contract/`. See [VALIDATION.md](./VALIDATION.md).
