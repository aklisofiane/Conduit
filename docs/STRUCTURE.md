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
    connections/                       per-workflow WorkflowConnection CRUD (alias → credential + optional
                                       owner/repo + encrypted webhookSecret)
    webhooks/                          POST /hooks/:workflowId — HMAC-verify, normalize, match, start run.
                                       Reads the raw body captured in main.ts express.json verify hook.
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
    poll-workflow.ts                   sandboxed shell that calls pollBoardActivity; scheduled
                                       by the API via Temporal Schedule
    topo-sort.ts                       pure graph ordering
  activities/
    run-agent-node.ts                  invokes provider, streams events via heartbeat + Redis
    load-graph.ts, cleanup-run.ts
    merge-worktree.ts                  clean-merge parallel branched worktree back into upstream
                                       (throws MergeConflictError on conflict — aborts the run)
    copy-conduit-files.ts              copies .conduit/<Node>.md from each parallel sibling into
                                       the merged upstream workspace (gitignored, so not in merge)
    poll-board.ts                      one poll cycle: fetch board items, apply filters, set-diff
                                       against PollSnapshot.matchingIds, start agentWorkflow per
                                       new match, upsert snapshot
  runtime/                             activity-side helpers (Prisma, Redis event bus, log writer,
                                       connection/credential lookup, plus the GitHub Projects v2
                                       GraphQL client `github-projects.ts`, the standalone
                                       `temporal-client.ts` singleton used by pollBoardActivity to
                                       start agentWorkflows from inside an activity, the
                                       `connection-context.ts` hydrator that builds the slim
                                       `ConnectionContext` the workspace manager needs — respects
                                       `CONDUIT_TEST_REMOTE_BASE` for E2E local bare repos — and
                                       `ticket-branch-store.ts`, the Prisma-backed `TicketBranchStore`
                                       adapter that owns slug derivation on first upsert)
```

If it touches I/O, it belongs under `activities/` or `runtime/`, never `workflows/`.

## apps/web (React + Vite)

```
src/
  main.tsx, routes/router.tsx
  pages/                               HomePage, CanvasPage, RunDetailPage, CredentialsPage, ConnectionsPage
  components/
    canvas/                            TriggerNode, AgentNode, NodePalette, AgentConfigPanel,
                                       TriggerConfigPanel (platform / connection / mode toggle /
                                       event / interval / BoardRef / filter builder), McpServerPicker
    run/                               RunTimeline (live trace), NodeSummary (.conduit/ body),
                                       ChangedFiles (workspace diff), NodeError (failure details) —
                                       tabs on the run detail page
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
  trigger/    TriggerEvent + TriggerConfig (incl. `BoardRef` for Projects v2 polling),
              filter/match logic, `poll.ts` (PollWorkflowInput + PollCycleResult)
  mcp/        MCP server config + tool schemas
  workflow/   Workflow.definition JSON schema (nodes, edges, ui) + `identity.ts`
              (isTicketBranchWorkflow / ticketLockFor) + `validate.ts`
              (save-time `validateWorkflowDefinition` — ticket-branch requires
              an issue-carrying trigger; wired into the API's create/update
              as a 400)
  workspace/  workspace kind schemas (local, repo-clone, inherit, ticket-branch)
  skill/      skill manifest types
  platform/   Platform enum + per-platform connection shapes
  runtime/    AgentEvent → ExecutionLogKind mapping, Redis channel name
  temporal/   task queue name + workflow-type constants (AGENT_WORKFLOW_TYPE,
              POLL_WORKFLOW_TYPE) + deterministic id helpers (`pollScheduleId`,
              `pollWorkflowId`, `agentWorkflowId(runId, ticketLock?)` — the
              ticket-branch dedup id `run-<wfId>-<ticketKey>` flows through here)
  crypto/     AES-256-GCM helpers                              backend-only subpath
  webhook/    HMAC signature verify + GitHub event normalizer  backend-only subpath
              (handles issues.opened / pull_request.opened / issue_comment.created /
              projects_v2_item.edited → board.column.changed)
```

`crypto` and `webhook` pull `node:crypto` — they're exposed as subpath exports only (not re-exported from the root barrel) so Vite can tree-shake them out of the web bundle.

## packages/agent

Provider abstraction + workspace + MCP + skills. **Core of the execution path.**

```
src/
  provider/
    types.ts                           AgentProvider / AgentSession interfaces (multi-turn)
    registry.ts                        selected by CONDUIT_PROVIDER env
    claude-provider.ts                 wraps @anthropic-ai/claude-agent-sdk (streaming-input query)
    codex-provider.ts                  wraps @openai/codex-sdk (persistent Thread, dynamic-loaded)
    stub-provider.ts                   scripted events for tests (real tools, fake LLM)
    async-queue.ts                     push-pull queue that feeds streaming-input SDKs one
                                       user message per turn while the session stays open
    constraints.ts
  workspace/
    index.ts                           barrel — every workspace export the worker needs
    manager.ts                         top-level orchestration (seed / branch / resolve)
    git.ts, paths.ts                   worktree seeding, path derivation
    conduit-folder.ts                  .conduit/<NodeName>.md reads/writes + cross-worktree copy
    merge.ts                           mergeBranchedWorktree + MergeConflictError (clean-merge path)
    ticket-branch.ts                   resolveTicketBranchWorkspace — check-then-create
                                       conduit/<ticket-id>-<slug> worktrees off the base clone
    slug.ts                            deriveSlug + formatBranchName — branch naming primitives
    lock.ts                            withPathLock — in-process base-clone mutex (one worker only)
    push-auth.ts                       installPushCredentials — per-run git credential helper
                                       script wired via credential.helper ! (no token in .git/config)
    types.ts                           workspace spec / resolved-workspace types + ConnectionContext,
                                       TicketContext, TicketBranchStore adapter interface
  mcp/
    resolve.ts                         decrypt credentials + {{credential}} substitution
    introspect.ts                      live `tools/list` via @modelcontextprotocol/sdk (stdio/sse/streamable-http)
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
  mock-github.ts                       local HTTP stand-in for GitHub's GraphQL API used by the
                                       Phase 4 poller test — `startMockGithubGraphql()` +
                                       `projectBoardResponse()` build canned Projects v2 payloads
  phase1-manual-run.test.ts            Phase 1 exit criterion as an E2E
  phase2-webhook-run.test.ts           Phase 2 — signed GitHub delivery → run → WS tool_call
  phase3-parallel-run.test.ts          Phase 3 — parallel fan-out + merge-back + .conduit/ copy
  phase4-polling-run.test.ts           Phase 4 — polling trigger, set-diff dedup, re-entry
  phase5-board-loop.test.ts            Phase 5 — ticket-branch workspaces + Dev→AIReview→Dev cycle;
                                       drives shell via StubProvider against a local bare repo
helpers/temporal.ts                    TestWorkflowEnvironment + MockActivityEnvironment wrappers
fixtures/
  workflows/                           seed JSON per topology (phase1 / phase2 / phase3 / phase4 /
                                       phase5-board-loop — Worker + Critic bundle)
  mcp-stub/                            in-repo stdio MCP server for tests
  events/github/                       GitHub webhook payload fixtures — see README in that folder
                                       (includes projects_v2_item.status_changed.json)
  repos/                               reserved
smoke/
  phase4.smoke.md                      Playwright MCP prose script for the trigger config panel
  phase5.smoke.md                      Playwright MCP prose script for the run detail ticket-branch
                                       header — validates the resolved `conduit/*` branch surfaces
```

Per-package unit tests sit next to source (`*.test.ts`); integration tests live under `<package>/test/integration/`; API contract tests under `apps/api/test/contract/`. See [VALIDATION.md](./VALIDATION.md).
