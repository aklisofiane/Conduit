# Structure

Where things live. Read [ARCHITECTURE.md](./ARCHITECTURE.md) for *why* first; this doc is a map, not an explanation.

## Top-level

```
apps/            runnable services (api, web, worker, agent-runner)
packages/        libraries (shared, database, agent)
docs/            spec — INDEX.md for read order
templates/       bundled workflow templates (JSON) — see docs/design-docs/templates.md
agent-presets/   reusable agent prompts referenced by templates and the canvas — see
                 docs/design-docs/agent-presets.md
scripts/         dev tooling — `preflight.ts` probes user-facing ports before
                 `infra:up`/`dev`/`test:infra:up`, allocates free ports on collision,
                 and writes `.env.local` for docker / API / worker / web / Prisma to
                 layer over `.env`. `CONDUIT_PREFLIGHT=skip` bypasses it
test/            cross-app test infra (e2e harness, fixtures, helpers)
```

Root configs: `turbo.json`, `tsconfig.base.json`, `vitest.workspace.ts`, `vitest.shared.ts`, `eslint.config.mjs`, `docker-compose.yml`, `docker-compose.test.yml`, `compose.override.yml` (preflight's `env_file: [.env, .env.local]` layering for raw `docker compose` users), `.env`.

## apps/api (NestJS — HTTP + WS)

```
src/
  main.ts, app.module.ts, config.ts   Nest bootstrap. main.ts mounts the Better Auth handler
                                       at /api/auth/* BEFORE express.json() — the handler needs
                                       the raw stream; webhook raw-body capture stays on the
                                       express.json verify hook.
  auth/                                Better Auth wiring. auth.config.ts builds the auth
                                       instance (Prisma adapter + organization plugin) and ships
                                       the signup-shim that creates a personal org and seeds
                                       session.activeOrganizationId. better-auth.middleware.ts is
                                       the Express adapter. session.guard.ts is the
                                       @UseGuards(SessionGuard) replacement for the old API-key
                                       guard. org-id.decorator.ts exposes @OrgId() — every guarded
                                       controller forwards req.session.activeOrganizationId to
                                       its service. auth.controller.ts serves the public
                                       GET /api/auth-config. See design-docs/auth-integration.md
                                       and design-docs/tenant-partitioning.md.
  common/                              Zod body pipe, Prisma service,
                                       `load-json-dir.ts` (shared JSON-folder loader used by
                                       templates + agent-presets — read dir, parse-or-skip,
                                       Zod-issue formatter)
  redis/, temporal/                    clients shared across modules
  modules/
    workflows/                         workflow CRUD + duplicate + webhook-secret PUT/DELETE
                                       (encrypted Workflow.webhookSecret — single secret per
                                       workflow, rotation overwrites)
    runs/                              run queries + Socket.IO gateway (runs.gateway.ts)
    credentials/                       Credential CRUD + AES-256-GCM (crypto.ts) +
                                       getConnectionBinding(connectionId) (Connection → Credential
                                       join, returns parsed scope + decrypted token)
    connections/                       global Connection CRUD over the typed scope union
                                       (github_repo / github_projects_v2 / none); refuses delete
                                       when any workflow's definition JSON references the row
    trigger/                           POST /trigger/list-projects + /trigger/list-labels — top-level
                                       config-time helpers; resolve a Connection, decrypt token,
                                       call the GitHub Projects v2 / labels client
    webhooks/                          POST /hooks/:workflowId — HMAC-verify against
                                       Workflow.webhookSecret, normalize, match, start run.
                                       Reads the raw body captured in main.ts express.json verify hook.
    mcp/                               POST /mcp/introspect — live tools/list
    skills/                            GET /skills
    templates/                         template catalog: loads /templates/*.json at boot,
                                       expands `presetId` references via AgentPresetsService,
                                       GET /templates + POST /workflows/from-template/:id
                                       (atomic $transaction materializes `new` bindings as
                                       global Connection rows once, substitutes placeholder ids
                                       into each workflow's definition, validates per-slot
                                       scope kinds; polling schedules upserted after commit)
    agent-presets/                     preset catalog: loads /agent-presets/*.json at boot,
                                       GET /agent-presets[/:id]; consumed by TemplatesService
                                       for template expansion and by the canvas's agent
                                       config-panel preset picker
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
  runtime/runner/                      runner-spawn primitive used by `runAgentNode` —
                                       `local-docker.ts` (LocalDockerSpawner: builds the
                                       `docker run` argv, pumps stdout via `json-line-iterator`,
                                       enforces a stdout-liveness timeout, kills via
                                       `docker kill <name>` so the container is reaped before the
                                       call returns), `docker-admin.ts` (`dockerPreflight` +
                                       `sweepOrphans` — both invoked from `main.ts`),
                                       `auth-mode.ts` (`CONDUIT_AGENT_AUTH` parser),
                                       `json-line-iterator.ts` (line-buffered RunnerEvent stream
                                       with an 8 MiB per-line cap), `resolve.ts`
                                       (image-tag picker + `setRunnerSpawnerForTest` hook),
                                       `spawner.ts` (RunnerSpawner / RunnerHandle interface)
```

If it touches I/O, it belongs under `activities/` or `runtime/`, never `workflows/`.

## apps/agent-runner (per-run sandbox container)

```
Dockerfile                             two-stage image — builder runs `tsc` for shared+agent+runner
                                       and `npm prune --omit=dev`; runtime layers `git`, `gh`, `jq`,
                                       `ripgrep`, `fd-find`, plus `make`/`python3`/`g++`/`pkg-config`
                                       for native module builds during agent-driven `npm install`.
                                       MCP packages and user project deps are NOT baked in — fetched
                                       at run time
src/
  main.ts                              one process per agent node — reads a `RunnerRequest` JSON
                                       object on stdin, drives turn 1 (main) → optional 2a (issue
                                       writeback) → 2b (final summary), forwards each `AgentEvent`
                                       as `{ kind: 'agent', event }` on stdout, then emits a terminal
                                       `exit` carrying head/changedFiles/conduitSummary. Heartbeats
                                       every 30s independent of agent flow
  protocol.test.ts                     guards the JSON-line wire format
```

Image tag resolution: `CONDUIT_RUNNER_IMAGE` (CI sets a git-sha tag), defaults to `agent-runner:dev`. The workspace `build` script chains `tsc` + `docker build` so any monorepo build keeps `agent-runner:dev` current; `npm run docker:agent-runner:build` forces a clean rebuild from the repo root. `pretest:e2e` builds `@conduit/agent-runner` alongside api+worker so e2e exercises the real image.

## apps/web (React + Vite)

```
src/
  main.tsx, routes/router.tsx
  pages/                               HomePage, CanvasPage, RunDetailPage, IntegrationsPage
                                       (Credentials + Connections combined under /settings —
                                       see docs/FRONTEND.md > Screens), AccountSettingsPage,
                                       SignInPage, SignUpPage, ForgotPasswordPage,
                                       ResetPasswordPage (auth pages — see
                                       docs/design-docs/web-auth-ui.md)
  components/
    canvas/                            TriggerNode, AgentNode, NodePalette, AgentConfigPanel,
                                       TriggerConfigPanel (platform / stacked Repo + Board
                                       connection sub-rows / mode toggle / event / interval /
                                       filter builder), McpServerPicker
    run/                               RunTimeline (live trace), NodeSummary (.conduit/ body),
                                       ChangedFiles (workspace diff), NodeError (failure details) —
                                       tabs on the run detail page
    templates/                         TemplatePickerDialog — "From template" flow on the
                                       workflow list (template grid → per-placeholder
                                       connection binding → POST /workflows/from-template/:id)
    settings/                          CredentialsSection + ConnectionsSection (extracted
                                       bodies of the old pages — composed by IntegrationsPage),
                                       settings-nav.ts (sidebar config; add an entry here +
                                       a child route in router.tsx to slot in API keys etc.)
    layout/                            TopChrome (global topbar shell, reads slot store; default
                                       actionsSlot is UserMenuPill), AppLayout, AuthLayout
                                       (unauthenticated centered-card shell), SettingsLayout
                                       (sidebar + outlet at /settings, driven by
                                       components/settings/settings-nav.ts), RequireAuth +
                                       RedirectIfAuthed (session gates), UserMenuPill (default
                                       topbar actions — name/email + popover with Account-settings
                                       + Sign-out; see docs/design-docs/web-auth-ui.md),
                                       WorkflowActions, etc.
    workflow-list/                     WorkflowRowItem + RowActionsMenu — rows on the
                                       workflow list (rename / duplicate / delete)
    common/                            shared UI primitives — `Dialog`, `DropdownMenu`,
                                       `Select` (thin Radix wrappers, styled via
                                       `.dialog-*` / `.dropdown-*` / `.select-*` classes
                                       in `globals.css`), plus `InlineRename`. The legacy
                                       `ui/` folder is empty
  api/
    client.ts, hooks.ts, types.ts      HTTP client (cookie-based, `credentials: 'include'`),
                                       TanStack Query hooks, response types
    auth-config.ts                     `useAuthConfig()` — TanStack hook over /api/auth-config
                                       (deployment + oauthProviders); cached forever per page
  hooks/use-run-updates.ts             Socket.IO → TanStack cache bridge
  state/
    workflow-editor.ts                 Zustand store for the canvas
    topbar-slots.ts                    Zustand store + `useTopbarSlots()` hook — pages publish
                                       ReactNodes into the global topbar (see FRONTEND.md > Run detail)
  lib/
    cn.ts, status.ts, time.ts          formatting helpers
    auth-client.ts                     Better Auth React client (createAuthClient against
                                       apiBaseUrl); exports signIn / signUp / signOut /
                                       useSession / requestPasswordReset / resetPassword
  styles/                              tokens.css (CSS vars), globals.css (@theme font bridge +
                                       component primitives), theme.ts (TS mirror + providerStyle).
                                       See docs/DESIGN.md.
```

## packages/shared

Zod schemas + cross-process contracts. Domain directories line up with subpath exports — import `@conduit/shared/agent` etc., not the root barrel.

```
src/
  agent/      AgentEvent, provider contract types, `issue-writeback.ts`
              (per-agent allowlist for end-of-run GitHub issue updates)
  connection/ ConnectionScope discriminated union (github_repo /
              github_projects_v2 / none) + expectScopeKind helper. Used by
              the API for connection CRUD validation and by the worker for
              runtime narrowing (poll-board source vs board lookup,
              repo-clone workspace owner/repo). Web-bundle safe.
  trigger/    TriggerEvent + TriggerConfig (named `connectionId` +
              optional `boardConnectionId` slots — no inline BoardRef),
              filter/match logic, `poll.ts` (PollWorkflowInput + PollCycleResult)
  mcp/        MCP server config + tool schemas
  workflow/   Workflow.definition JSON schema (nodes, edges, ui) + `identity.ts`
              (isTicketBranchWorkflow / ticketLockFor) + `validate.ts`
              (save-time `validateWorkflowDefinition` — ticket-branch requires
              an issue-carrying trigger; wired into the API's create/update
              as a 400)
  template/   Template file schema (bundle of one or more workflow definitions)
              + `<alias>` placeholder detection + `resolveTemplate` (substitutes
              placeholders with real Connection cuids for instantiation)
              + `collectTemplatePlaceholderDetails` (per-slot expected scope
              kinds — github_repo for triggers, github_projects_v2 for board
              slots, 'any' for MCP) + `expandTemplate` (rewrites
              `presetId`-using agents into the runtime agent shape using a
              preset resolver)
  agent-preset/ AgentPreset file schema — id, name, category, provider, model,
              instructions (+ optional suggestedConstraints). Catalog data
              referenced by templates (via presetId) and the canvas picker
  workspace/  workspace kind schemas (inherit, ticket-branch — derived from
              edges by `workflow/derive-workspace.ts`, not user-authored)
  skill/      skill manifest types
  platform/   Platform enum + per-platform connection shapes. Under `github/`,
              shared HTTP plumbing (`http.ts` — lazy URL/header helpers, web-bundle
              safe), the Projects v2 GraphQL client (`projects.ts`), and the
              repo-labels REST client (`labels.ts`, used by the agent panel's
              issue-writeback picker)
  runtime/    AgentEvent → ExecutionLogKind mapping, Redis channel name
  temporal/   task queue name + workflow-type constants (AGENT_WORKFLOW_TYPE,
              POLL_WORKFLOW_TYPE) + deterministic id helpers (`pollScheduleId`,
              `pollWorkflowId`, `agentWorkflowId(runId, ticketLock?)` — the
              ticket-branch dedup id `run-<wfId>-<ticketKey>` flows through here)
  crypto/     AES-256-GCM helpers                              backend-only subpath
  webhook/    HMAC signature verify + GitHub event normalizer  backend-only subpath
              (handles issues.opened / pull_request.opened / issue_comment.created /
              projects_v2_item.edited → board.column.changed)
  runner/     Worker ↔ agent-runner JSON-line protocol — `RunnerRequest` (stdin payload:
              run identity, provider creds, fully-resolved `AgentRequest`, pre-rendered prompts
              for the three turns) and `RunnerEvent` (stdout: `agent` / `system` / `heartbeat`
              / terminal `exit ok|err`). Transport-agnostic; both apps/worker and apps/agent-runner
              import from this subpath. See [agent-execution.md](./design-docs/agent-execution.md#runner-container-model)
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
  phase2-webhook-run.test.ts           Phase 2 — signed GitHub delivery → run → WS tool_call
  phase3-parallel-run.test.ts          Phase 3 — parallel fan-out + merge-back + .conduit/ copy
  phase4-polling-run.test.ts           Phase 4 — polling trigger, set-diff dedup, re-entry
  phase5-board-loop.test.ts            Phase 5 — ticket-branch workspaces + Dev→AIReview→Dev cycle;
                                       drives shell via StubProvider against a local bare repo
  phase6-template-run.test.ts          Phase 6 — GET /templates catalog + POST /workflows/from-template/:id
                                       bundle creation, placeholder resolution, polling schedule upsert,
                                       missing-binding 400
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
  phase6.smoke.md                      Playwright MCP prose script for the "From template"
                                       picker + bundle-creation flow
```

Per-package unit tests sit next to source (`*.test.ts`); integration tests live under `<package>/test/integration/`; API contract tests under `apps/api/test/contract/`. See [VALIDATION.md](./VALIDATION.md).
