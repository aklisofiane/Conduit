# Plans

Phased rollout. Each phase ends with something runnable end-to-end.

## Phase 0 — Spec & scaffolding ✅

- [x] `docs/` spec written
- [x] Review & iterate
- [x] Fresh repo initialized
- [x] Monorepo skeleton: npm workspaces + Turborepo, tsconfig bases, Tailwind v4 + shadcn preset, Vite alias, root `.env` convention
- [x] Docker compose with Postgres (5434), Temporal (7233), Redis (6379), Temporal UI (8080)
- [x] `@conduit/shared` package with the core types from `node-system.md` + `agent-context.md` + Zod schemas
- [x] `@conduit/database` with the Prisma schema from `data-model.md`
- [x] ESLint + Prettier config at the root

**Exit criteria**: `npm run db:push` works, shared types compile, no apps yet.

## Phase 1 — Single agent, manual run ✅

The smallest useful system: a workflow with one agent, started manually from the UI, streaming live output.

- [x] `@conduit/agent` package: provider interface, Claude provider (wraps `@anthropic-ai/claude-agent-sdk`), workspace manager.
- [x] Codex provider stubbed (implement in Phase 2 if SDK work is gnarly).
- [x] `apps/api` (NestJS): workflow CRUD, `POST /workflows/:id/run` (manual run endpoint), `RunsGateway` WS, credential CRUD, Temporal client.
- [x] `apps/worker`: `agentWorkflow` (single-node case), `runAgentNode` activity with SDK built-in tools, heartbeat → Redis.
- [x] Skill discovery: `GET /skills` scans repo + worker for `SKILL.md` files, copy selected skills into workspace at runtime.
- [x] `apps/web`: workflow list, canvas with `TriggerNode` + `AgentNode` (design only), skill picker in agent config, manual "Run" button, run detail page with live streaming logs.

**Exit criteria**: User creates a workflow with a Claude agent + workspace, clicks "Run", agent uses SDK built-in tools (file read, shell), watches streaming output on the run detail page.

## Phase 1.5 — Validation harness ✅

Make every later phase's exit criterion autonomously verifiable. See [VALIDATION.md](./VALIDATION.md).

- [x] `StubProvider` in `@conduit/agent` alongside `ClaudeProvider`: same interface, replays scripted events (text chunks, tool calls, final message) with configurable delays. Real tools, fake LLM. Selected via `CONDUIT_PROVIDER=stub` and scripts injected via in-process queue or `CONDUIT_STUB_SCRIPT` file.
- [x] `docker-compose.test.yml`: Postgres + Temporal + Redis on non-dev ports (55432 / 57233 / 56379), tmpfs volumes, temporal healthcheck that waits for namespace readiness.
- [x] Vitest workspace config: `unit` (per package), `integration`, `api` (supertest), `e2e` (full stack). Sources aliased to src so tests run without a build.
- [x] Temporal test utilities: `test/helpers/temporal.ts` wrapping `TestWorkflowEnvironment.createTimeSkipping()` and `MockActivityEnvironment` with `loadWorkflowFixture()`.
- [x] E2E harness (`test/e2e/harness.ts`): spins up test stack + api + worker subprocesses + `StubProvider`, returns `HttpClient` and `WsCollector`, tears down on exit.
- [x] Fixture directories: `test/fixtures/workflows/` (Phase 1 JSON), `test/fixtures/mcp-stub/` (in-repo stdio MCP server). `repos/` + `events/` land in Phase 2 when they're first needed.
- [x] Playwright MCP wiring: documented user-configured setup + per-phase smoke pattern in VALIDATION.md.
- [x] CI: `.github/workflows/test.yml` running typecheck + lint + unit on every PR; E2E behind the unit gate; Playwright smoke on main.
- [x] Backfill Phase 1 exit criterion as the first E2E test (`test/e2e/phase1-manual-run.test.ts`).

**Exit criteria**: `npm test` runs the full suite (unit + integration + API + E2E) against an ephemeral test stack using `StubProvider`, completes in under 5 minutes, and the Phase 1 golden path is covered by a passing E2E test. Claude can run `npm test` and read pass/fail output.

## Phase 2 — GitHub trigger + MCP + repo workspace ✅

Make it useful for real dev work.

- [x] `@conduit/agent`: MCP config resolver (decrypt credentials, substitute `{{credential}}`, hand to SDK).
- [x] `POST /mcp/introspect` endpoint using `@modelcontextprotocol/sdk` for tool discovery at config time.
- [x] Codex provider (full implementation wrapping `@openai/codex-sdk`).
- [x] Webhook ingestion (`POST /api/hooks/:workflowId`) with HMAC verification.
- [x] `TriggerEvent` normalization for GitHub (issue opened, PR opened, PR comment).
- [x] GitHub MCP server preset (`@modelcontextprotocol/server-github`) with credential binding.
- [x] `WorkflowConnection` + `PlatformCredential` UI.
- [x] Workspace `repo-clone` kind — seeded from base clone, token stripped.
- [x] Custom MCP server config UI (stdio + SSE/HTTP transports).
- [x] Per-tool `allowedTools` filtering in the MCP server picker (uses cached `discoveredTools`).

**Exit criteria**: User connects a GitHub repo, creates a workflow with "on issue opened" trigger → agent with GitHub MCP server + repo workspace → agent reads the issue, inspects the code, posts a comment. Covered by `test/e2e/phase2-webhook-run.test.ts`.

## Phase 3 — Multi-agent, parallel, workspace inheritance ✅

The canvas earns its keep.

- [x] Parallel group execution in `agentWorkflow` (topo sort into groups, `Promise.all`).
- [x] Workspace `inherit` kind: sequential passthrough + parallel branching.
- [x] `.conduit/` folder: agents write `.conduit/<NodeName>.md` summaries as a final prompt, downstream agents read them. Provider sessions went multi-turn (`AgentProvider.startSession` → `AgentSession.run(userMessage)`) so the summary reuses the same SDK thread as the main turn.
- [x] Sequential merge-back after parallel groups (`mergeWorktreeActivity`). Ships the clean-merge happy path; the conflict-resolution agent session is deferred — merge conflicts throw `MergeConflictError` with the conflicted file list and abort the merge cleanly.
- [x] `.conduit/` file copy from parallel worktrees into target workspace (`copyConduitFilesActivity`).
- [x] Run detail page polish: per-node timeline / summary / changed files / error tabs. `NodeRun.conduitSummary` persists the `.conduit/` body past workspace cleanup so the Summary tab still works after the run ends.

**Exit criteria**: User builds a 3-agent workflow (Triage → Fix + Doc in parallel → Review), runs it on a real issue, sees parallel execution on the run detail page, sees Fix and Doc operate on branched worktrees with sequential merge-back, sees Review read `.conduit/` summaries from both. Covered by `test/e2e/phase3-parallel-run.test.ts`.

## Phase 4 — Polling trigger + board orchestration ✅

Ship the board-as-orchestrator pattern.

- [x] Polling trigger: Temporal Schedule (created/updated/deleted on workflow save via `TemporalService`, reconciled at API boot), `pollWorkflow` → `pollBoardActivity` runs once per tick, set-diff dedup via `PollSnapshot.matchingIds`.
- [x] GitHub Projects board column-move event normalization: `projects_v2_item.edited` (single-select field) → `board.column.changed` on the webhook side; polling side synthesizes the same event shape from the Projects v2 GraphQL API.
- [x] Trigger UI: `TriggerConfigPanel` with platform picker, connection picker, mode toggle (webhook / polling), event picker, interval input, `BoardRef` fieldset (org/user + owner + project number), active flag, filter builder.
- [x] End-to-end board flow: `test/e2e/phase4-polling-run.test.ts` covers the exit criterion — polling fires runs on set-diff and re-fires on re-entry (Dev → Review → Dev). Playwright smoke at `test/smoke/phase4.smoke.md`.

**Exit criteria**: User configures a polling trigger on `status = "Dev"`, workflow runs whenever an issue enters that column. Covered by `test/e2e/phase4-polling-run.test.ts`.

## Phase 5 — Board loops (`ticket-branch`)

Iterative Worker↔Critic workflows that persist state across runs. See [branch-management.md](./design-docs/branch-management.md).

- [ ] `ticket-branch` workspace kind in `@conduit/agent/workspace`: branch name derivation, check-then-create against remote, worktree setup.
- [ ] `TicketBranch` Prisma row (keyed by `(platform, owner, repo, ticketId)` — shared across workflows) storing the stable slug. Update [data-model.md](./data-model.md).
- [ ] Push auth: platform token injected into agent process env + git credential helper that reads from env. Never written to `.git/config` or remote URL.
- [ ] Local file lock on the base-clone path to serialize `git worktree add` races.
- [ ] Temporal workflow-ID uniqueness for `ticket-branch` workflows: deterministic ID `run-<workflowId>-<ticketId>`, started with `WorkflowIdConflictPolicy = FAIL` (Temporal default — rejects starts against an in-flight ID with `WorkflowExecutionAlreadyStarted`, caught by the trigger handler to silently drop duplicate triggers) and `WorkflowIdReusePolicy = ALLOW_DUPLICATE` (lets the same ID be reused after termination, so board cycles re-fire).
- [ ] `cleanupRunActivity` split: local worktree always cleaned; remote branch preserved for `ticket-branch`.
- [ ] Save-time validation: `ticket-branch` requires a trigger that guarantees an issue/PR identifier.
- [ ] Run detail page: show `conduit/*` branch name and link to the PR if one exists.

**Exit criteria**: user builds a Worker workflow (triggered on `status = Dev`) and a Critic workflow (triggered on `status = AIReview`), runs them against a real issue, sees iteration N+1 build on iteration N's commits, sees the Critic's comments flow back to the Worker on the next iteration.

## Phase 6 — Workflow templates

Ship starter templates so users don't face an empty canvas.

- [ ] `/templates/` directory with JSON template files.
- [ ] `GET /api/templates` endpoint: reads `/templates/*.json`, returns list.
- [ ] Template schema supports **one or more workflows per file** (multi-workflow bundles) — see [templates.md](./design-docs/templates.md).
- [ ] `POST /api/workflows/from-template/:templateId`: creates all workflows in the template atomically (single transaction), returns the list of created IDs.
- [ ] UI: "Create from template" flow on workflow creation — picker with name, description, category, workflow count.
- [ ] Connection binding UI: prompts once per unique placeholder across all workflows in the bundle; resolved placeholders are applied to each workflow on save.
- [ ] Ship v1 templates: `analyze`, `develop`, `pr-review` (single-workflow each), `board-loop` (Worker + Critic bundle, for the pattern from Phase 5).

**Exit criteria**: new user clones the repo, starts Conduit, picks the `analyze` template, binds their GitHub connection, runs it on a real issue.

## Phase 7 — More presets, polish, ship

- [ ] MCP presets for Slack, Discord, PostgreSQL, Brave Search.
- [ ] Run history page, run search/filter.
- [ ] Credential rotation UX.
- [ ] Janitor cron for workspace cleanup + log retention (30-day TTL on `ExecutionLog`).
- [ ] Documentation: user guide, MCP server setup guide.

**Exit criteria**: feature-complete v1. Ship.

## Phase 8+ — Later

Not committed, in rough priority order:
- Platform abstraction layer for triggers (GitLab boards, Jira boards) — GitHub is the first implementation, the trigger system is designed for multi-platform from the start
- Expose Conduit workflows as MCP tools (so other agents can invoke workflows)
- Custom agent provider SDK
- Multi-tenant + RBAC
- Workflow versioning + rollback
- Agent session resumability (if providers ever support it)
- Per-run container isolation for MCP server processes
- Auto-janitor for `conduit/*` branches after PR merge + ticket close
- Auto-rebase of `ticket-branch` branches on drift from `main`
- Redundant-run dedup + webhook storm backpressure (beyond Temporal workflow-ID uniqueness)
- Save-time designated pusher for `ticket-branch` workflows (e.g., `pushes: true` flag on the workspace spec, validator enforces exactly one) — removes the "who pushes?" ambiguity in multi-terminal DAGs
- Scoped env injection for `ticket-branch` push credentials — set the token only at the git-shell-invocation boundary rather than process-wide, so stdio MCP servers spawned as children of the agent don't inherit it. See [SECURITY.md](./SECURITY.md#credential-storage).
- Merge-back agent session for conflict resolution — Phase 3 ships clean merges only; a conflicted `mergeWorktreeActivity` currently aborts and fails the run. The design (see [agent-execution.md](./design-docs/agent-execution.md#merge-back-agent)) is a short-lived agent session with workspace tools that reads conflict markers, reconciles, and commits.

## Explicitly deferred

- Custom tool registry / proprietary tool format — MCP is the standard
- Visual variable picker with upstream field introspection — agents read `.conduit/` files directly
- Multi-trigger workflows — one trigger per workflow in v1
