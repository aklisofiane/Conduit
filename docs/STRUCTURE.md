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
scripts/         dev tooling — `preflight.ts` probes ports before infra:up/dev,
                 allocates free ones on collision, writes `.env.local`
                 (`CONDUIT_PREFLIGHT=skip` bypasses). See ARCHITECTURE.md + CLAUDE.md
test/            cross-app test infra (e2e harness, fixtures, helpers)
```

Root configs: `turbo.json`, `tsconfig.base.json`, `vitest.workspace.ts`, `vitest.shared.ts`, `eslint.config.mjs`, `docker-compose.yml`, `docker-compose.test.yml`, `compose.override.yml` (preflight's `env_file: [.env, .env.local]` layering for raw `docker compose` users), `.env`.

## apps/api (NestJS — HTTP + WS)

```
src/
  main.ts, app.module.ts, config.ts   Nest bootstrap (Better Auth handler mounts before
                                       express.json — see ARCHITECTURE.md > Auth).
  auth/                                Better Auth wiring — auth.config.ts (auth instance +
                                       signup-shim), better-auth.middleware.ts (Express adapter),
                                       session.guard.ts, org-id.decorator.ts (@OrgId()),
                                       auth.controller.ts (public GET /api/auth-config). See
                                       design-docs/auth-integration.md + tenant-partitioning.md.
  common/                              Zod body pipe, Prisma service, `load-json-dir.ts`
                                       (shared JSON-folder loader for templates + agent-presets)
  redis/, temporal/                    clients shared across modules; temporal/ holds
                                       `temporal-slug.ts` (Prisma side of
                                       design-docs/temporal-id-slug.md)
  modules/
    workflows/                         workflow CRUD + duplicate + webhook-secret PUT/DELETE
    runs/                              run queries + Socket.IO gateway (runs.gateway.ts)
    credentials/                       Credential CRUD + AES-256-GCM (crypto.ts) +
                                       getConnectionBinding (Connection→Credential join)
    connections/                       global Connection CRUD over the typed scope union;
                                       refuses delete when a workflow definition references the row.
                                       `connection-analysis.service.ts` owns the analyze action
                                       (POST/GET :id/analyze|analysis) — see design-docs/repo-analysis.md
    provider-configs/                  per-org LLM provider API keys — distinct from Credential;
                                       see docs/data-model.md > ProviderConfig
    trigger/                           POST /trigger/list-projects + /trigger/list-labels
                                       + /trigger/ensure-labels config-time helpers
    webhooks/                          POST /hooks/:workflowId — HMAC-verify, normalize, match,
                                       start run
    mcp/                               POST /mcp/introspect — live tools/list
    skills/                            GET /skills
    templates/                         template catalog: loads /templates/*.json at boot, expands
                                       `presetId` refs, GET /templates +
                                       POST /workflows/from-template/:id — see design-docs/templates.md
    agent-presets/                     preset catalog: loads /agent-presets/*.md at boot,
                                       GET /agent-presets[/:id] — see design-docs/agent-presets.md
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
    cron-workflow.ts                   sandboxed shell for cron triggers — one tick per
                                       Temporal Schedule fire
    repo-analysis-workflow.ts          sandboxed — dynamic fan-out over discovered
                                       components (clone → Discover → Design ≤12 → Assemble →
                                       cleanup); see design-docs/repo-analysis.md
    repo-analysis-nodes.ts             pure module — inlined Discover/Design analyzer prompts
                                       + node builders (no agent-presets/*.md for the analyzer)
    topo-sort.ts                       pure graph ordering
  activities/
    run-agent-node.ts                  invokes provider, streams events via heartbeat + Redis
    writeback.ts                       pure issue-writeback helpers (unit-testable apart from
                                       run-agent-node's Temporal/Prisma imports)
    cron-fire.ts                       one cron tick — build TriggerEvent, start agentWorkflow
    load-graph.ts, cleanup-run.ts
    merge-worktree.ts                  clean-merge parallel worktree back into upstream
                                       (throws MergeConflictError on conflict)
    copy-conduit-files.ts              copies .conduit/<Node>.md across parallel siblings
    poll-board.ts                      one poll cycle: fetch, filter, set-diff against
                                       PollSnapshot, start agentWorkflow per new match
    clone-analysis-workspace.ts        prime the base bare clone + probe default branch
    read-analysis-artifacts.ts         read + Zod-validate the analyzer's JSON artifacts
                                       (ComponentManifest / WorkflowDraft)
    update-analysis-phase.ts           write RepoAnalysis status/phase from the workflow
    assemble-suggestions.ts            stitch drafts → validated TemplateFile, persist on
                                       RepoAnalysis (see design-docs/repo-analysis.md)
  runtime/                             activity-side helpers — Prisma, Redis event bus, log writer,
                                       connection/credential lookup, `temporal-client.ts` (singleton
                                       that starts agentWorkflows from inside pollBoardActivity),
                                       `connection-context.ts` (hydrates the slim `ConnectionContext`;
                                       honors `CONDUIT_TEST_REMOTE_BASE`), `ticket-branch-store.ts`
                                       (Prisma-backed `TicketBranchStore`), `provider-config.ts`
                                       (`loadProviderConfig` — DB-row-wins, env fallback). The GitHub
                                       Projects v2 client is NOT here — see
                                       packages/shared/src/platform/github/projects.ts below.
  runtime/runner/                      runner-spawn primitive used by `runAgentNode`: `mode.ts`
                                       (deployment × runner-mode → 'docker' | 'host'), `local-docker.ts`
                                       (LocalDockerSpawner), `local-process.ts` (LocalProcessSpawner),
                                       `event-pump.ts` (stdout pump — liveness, stderr tail, synthetic
                                       exit), `docker-admin.ts` / `process-admin.ts` (preflight +
                                       orphan sweep, per spawner), `auth-mode.ts`, `json-line-iterator.ts`,
                                       `resolve.ts` (spawner picker), `spawner.ts` (interfaces)
```

If it touches I/O, it belongs under `activities/` or `runtime/`, never `workflows/`.

## apps/agent-runner (per-run sandbox container)

```
Dockerfile                             two-stage image — builder `tsc`s shared+agent+runner +
                                       prunes dev deps; runtime layers git/gh/jq/ripgrep/fd-find +
                                       native-build toolchain. MCP + project deps fetched at run time
src/
  main.ts                              one process per agent node — reads `RunnerRequest` on stdin,
                                       drives main → optional issue-writeback → final-summary turns,
                                       forwards each `AgentEvent` on stdout, emits terminal `exit`.
                                       See design-docs/agent-execution.md > Runner container model
  protocol.test.ts                     guards the JSON-line wire format
```

Image tag: `CONDUIT_RUNNER_IMAGE` (CI sets a git-sha tag), defaults to `agent-runner:dev`; the workspace `build` chains `tsc` + `docker build`. In **host runner mode** (local-deployment default; see [agent-execution.md](./design-docs/agent-execution.md#host-mode-local-deployments)) no image is involved — the worker spawns `dist/main.js` directly.

## apps/web (React + Vite)

```
src/
  main.tsx, routes/router.tsx
  pages/                               HomePage, CanvasPage, RunDetailPage, IntegrationsPage
                                       (Credentials + Connections under /settings), ApiKeysPage
                                       (/settings/api-keys), AccountSettingsPage, and the auth
                                       pages SignIn/SignUp/ForgotPassword/ResetPassword. See
                                       docs/FRONTEND.md > Screens + design-docs/web-auth-ui.md
  components/
    canvas/                            Typed trigger nodes + panels per variant (Issues /
                                       PullRequests / Cron / Webhook placeholder), shared
                                       trigger chrome (trigger-node-common, trigger-panel-common),
                                       AgentNode, NodePalette, AgentConfigPanel, McpServerPicker
    run/                               RunTimeline (live trace), NodeSummary (.conduit/ body),
                                       ChangedFiles (workspace diff), NodeError (failure details) —
                                       tabs on the run detail page
    templates/                         TemplatePickerDialog — "From template" flow on the
                                       workflow list (template grid → per-placeholder
                                       connection binding → POST /workflows/from-template/:id)
    settings/                          CredentialsSection + ConnectionsSection (→ IntegrationsPage),
                                       ApiKeysSection (→ ApiKeysPage), settings-nav.ts (sidebar
                                       config — add an entry + a child route in router.tsx to
                                       slot in new sections). ConnectionsSection hosts the repo
                                       Analyze action + progress card; SuggestionsGalleryDialog
                                       imports the result (see design-docs/repo-analysis.md)
    layout/                            TopChrome (topbar shell, reads slot store), AppLayout,
                                       AuthLayout, SettingsLayout (sidebar + outlet at /settings),
                                       RequireAuth + RedirectIfAuthed (session gates), UserMenuPill
                                       (default topbar actions), WorkflowActions, etc. See
                                       docs/design-docs/web-auth-ui.md
    workflow-list/                     WorkflowRowItem + RowActionsMenu — rows on the
                                       workflow list (rename / duplicate / delete)
    common/                            shared UI primitives — `Dialog`, `DropdownMenu`, `Select`
                                       (thin Radix wrappers), `InlineRename`, `BrandGlyph.tsx`
                                       (Conduit `Logo` + `ProviderGlyph`)
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
  analysis/   Repo-analysis contracts (see design-docs/repo-analysis.md):
              ComponentManifest + WorkflowDraft schemas, the reviewer-domain
              catalog, the analysis adapter (synthetic `analysis` trigger +
              fixed artifact paths), and pure `assembleSuggestionBundle`
  connection/ ConnectionScope discriminated union (github_repo /
              github_projects_v2 / none) + expectScopeKind helper. Web-bundle safe.
  label/      Canonical registry of Conduit's own `conduit-*` labels
              (CONDUIT_LABELS + isConduitLabel / getConduitLabel) — single
              source of truth for which labels are ours; read by the ensure
              endpoint and the label UI affordances. Web-bundle safe.
  trigger/    TriggerEvent + TriggerConfig (issues / pull_requests / cron /
              webhook), filter/match logic, `poll.ts` (PollWorkflowInput +
              PollCycleResult)
  mcp/        MCP server config + tool schemas
  workflow/   Workflow.definition JSON schema (nodes, edges, ui) + `identity.ts`
              (isTicketBranchWorkflow / ticketLockFor) + `validate.ts`
              (save-time `validateWorkflowDefinition` — ticket-branch requires
              an issue-carrying trigger; wired into the API's create/update
              as a 400)
  template/   Template file schema + `resolveTemplate` (placeholder → Connection cuid),
              `collectTemplatePlaceholderDetails` (per-slot expected scope kinds),
              `expandTemplate` (presetId agents → runtime shape). See design-docs/templates.md
  agent-preset/ AgentPreset file schema — id, name, category, provider, model,
              instructions (+ optional suggestedConstraints). Catalog data
              referenced by templates (via presetId) and the canvas picker
  workspace/  workspace kind schemas (inherit, ticket-branch, fixed-branch —
              derived from edges + trigger kind by `workflow/derive-workspace.ts`,
              not user-authored)
  skill/      skill manifest types
  platform/   Platform enum + per-platform connection shapes. Under `github/`,
              shared HTTP plumbing (`http.ts` — lazy URL/header helpers, web-bundle
              safe), the Projects v2 GraphQL client (`projects.ts`), and the
              labels REST client (`labels.ts` — `listRepoLabels` for the agent
              panel's issue-writeback picker + idempotent `createRepoLabel`).
              `gitlab/labels.ts` mirrors it (`listGitlabProjectLabels` +
              `createGitlabProjectLabel`), returning the same `RepoLabel` shape
  runtime/    AgentEvent → ExecutionLogKind mapping, Redis channel name
  temporal/   task queue name + workflow-type constants + deterministic id helpers
              (`workflowScheduleId` / `pollWorkflowId` / `cronWorkflowId` /
              `agentWorkflowId`, optional `slug` prefix) + `buildTemporalSlug`
              (sandbox-safe; see design-docs/temporal-id-slug.md)
  crypto/     AES-256-GCM helpers                              backend-only subpath
  webhook/    HMAC signature verify + GitHub event normalizer  backend-only subpath
              (handles issues.opened / pull_request.opened / issue_comment.created /
              projects_v2_item.edited → board.column.changed)
  runner/     Worker ↔ agent-runner JSON-line protocol — `RunnerRequest` (stdin) +
              `RunnerEvent` (stdout). Imported by both worker and agent-runner. See
              [agent-execution.md](./design-docs/agent-execution.md#runner-container-model)
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
    manager.ts                         top-level orchestration — dispatches ticket-branch,
                                       fixed-branch, or inherit
    git.ts, paths.ts                   worktree seeding, path derivation
    git-helpers.ts                     shared base-clone / fetch / ref helpers used by both
                                       ticket-branch and fixed-branch resolvers: ensureBaseClone,
                                       fetchWithAuth, remoteBranchExists, defaultBranch,
                                       stripRemoteAuth, addTrackingWorktree, createTrackingWorktree
    conduit-folder.ts                  .conduit/<NodeName>.md reads/writes + cross-worktree copy
    merge.ts                           mergeBranchedWorktree + MergeConflictError (clean-merge path)
    ticket-branch.ts                   resolveTicketBranchWorkspace — check-then-create
                                       conduit/<ticket-id>-<slug> worktrees off the base clone
    fixed-branch.ts                    resolveFixedBranchWorkspace — cron triggers; branch
                                       must exist on remote
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
  mock-github.ts                       local HTTP stand-in for GitHub's GraphQL API —
                                       `startMockGithubGraphql()` + canned payload builders
  *.test.ts                            phase exit-criterion suites (phase2–phase6) plus the
                                       auth/authz/cross-org suites — see the directory + VALIDATION.md
helpers/temporal.ts                    TestWorkflowEnvironment + MockActivityEnvironment wrappers
fixtures/
  workflows/                           seed JSON per topology
  mcp-stub/                            in-repo stdio MCP server for tests
  events/github/                       GitHub webhook payload fixtures — see README in that folder
  orgs/                                multi-tenant seed (two-orgs) for contract/cross-org tests
  repos/                               reserved (tests use local bare repos via CONDUIT_TEST_REMOTE_BASE)
smoke/                                 Playwright-MCP prose scripts (phase* + auth + org-switching) —
                                       see the directory + VALIDATION.md > UI smoke tests
```

Per-package unit tests sit next to source (`*.test.ts`); integration tests live under `<package>/test/integration/`; API contract tests under `apps/api/test/contract/`. See [VALIDATION.md](./VALIDATION.md).
