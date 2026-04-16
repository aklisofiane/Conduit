# Plans

Phased rollout. Each phase ends with something runnable end-to-end.

## Phase 0 — Spec & scaffolding (current)

- [x] `docs/` spec written
- [ ] Review & iterate
- [ ] Fresh repo initialized
- [ ] Monorepo skeleton: npm workspaces + Turborepo, tsconfig bases, Tailwind v4 + shadcn preset, Vite alias, root `.env` convention
- [ ] Docker compose with Postgres (5434), Temporal (7233), Redis (6379), Temporal UI (8080)
- [ ] `@conduit/shared` package with the core types from `node-system.md` + `agent-context.md` + Zod schemas
- [ ] `@conduit/database` with the Prisma schema from `data-model.md`
- [ ] ESLint + Prettier config at the root

**Exit criteria**: `npm run db:push` works, shared types compile, no apps yet.

## Phase 1 — Single agent, manual run

The smallest useful system: a workflow with one agent, started manually from the UI, streaming live output.

- [ ] `@conduit/agent` package: provider interface, Claude provider (wraps `@anthropic-ai/claude-agent-sdk`), workspace manager.
- [ ] Codex provider stubbed (implement in Phase 2 if SDK work is gnarly).
- [ ] `apps/api` (NestJS): workflow CRUD, `POST /workflows/:id/run` (manual run endpoint), `RunsGateway` WS, credential CRUD, Temporal client.
- [ ] `apps/worker`: `agentWorkflow` (single-node case), `runAgentNode` activity with SDK built-in tools, heartbeat → Redis.
- [ ] Skill discovery: `GET /skills` scans repo + worker for `SKILL.md` files, copy selected skills into workspace at runtime.
- [ ] `apps/web`: workflow list, canvas with `TriggerNode` + `AgentNode` (design only), skill picker in agent config, manual "Run" button, run detail page with live streaming logs.

**Exit criteria**: User creates a workflow with a Claude agent + workspace, clicks "Run", agent uses SDK built-in tools (file read, shell), watches streaming output on the run detail page.

## Phase 2 — GitHub trigger + MCP + repo workspace

Make it useful for real dev work.

- [ ] `@conduit/agent`: MCP config resolver (decrypt credentials, substitute `{{credential}}`, hand to SDK).
- [ ] `POST /mcp/introspect` endpoint using `@modelcontextprotocol/sdk` for tool discovery at config time.
- [ ] Codex provider (full implementation wrapping `@openai/codex-sdk`).
- [ ] Webhook ingestion (`POST /api/hooks/:workflowId`) with HMAC verification.
- [ ] `TriggerEvent` normalization for GitHub (issue opened, PR opened, PR comment).
- [ ] GitHub MCP server preset (`@modelcontextprotocol/server-github`) with credential binding.
- [ ] `WorkflowConnection` + `PlatformCredential` UI.
- [ ] Workspace `repo-clone` kind — seeded from base clone, token stripped.
- [ ] Custom MCP server config UI (stdio + SSE/HTTP transports).
- [ ] Per-tool `allowedTools` filtering in the MCP server picker (uses cached `discoveredTools`).

**Exit criteria**: User connects a GitHub repo, creates a workflow with "on issue opened" trigger → agent with GitHub MCP server + repo workspace → agent reads the issue, inspects the code, posts a comment.

## Phase 3 — Multi-agent, parallel, workspace inheritance

The canvas earns its keep.

- [ ] Parallel group execution in `agentWorkflow` (topo sort into groups, `Promise.all`).
- [ ] Workspace `inherit` kind: sequential passthrough + parallel branching.
- [ ] `.conduit/` folder: agents write `.conduit/<NodeName>.md` summaries as a final prompt, downstream agents read them.
- [ ] Sequential merge-back after parallel groups (`mergeWorktreeActivity` — lightweight agent session for conflict resolution).
- [ ] `.conduit/` file copy from parallel worktrees into target workspace.
- [ ] Run detail page polish: per-node timeline tabs, `.conduit/` summary view, changed files diff, error view.

**Exit criteria**: User builds a 3-agent workflow (Triage → Fix + Doc in parallel → Review), runs it on a real issue, sees parallel execution on the run detail page, sees Fix and Doc operate on branched worktrees with sequential merge-back, sees Review read `.conduit/` summaries from both.

## Phase 4 — Polling trigger + board orchestration

Ship the board-as-orchestrator pattern.

- [ ] Polling trigger: Temporal schedule, set-diff dedup via `PollSnapshot` table.
- [ ] GitHub Projects board column-move event normalization (webhook + polling).
- [ ] Trigger UI: mode toggle (webhook / polling), active flag, filter builder, interval picker.
- [ ] End-to-end board flow: agent moves issues between columns via GitHub MCP.

**Exit criteria**: User configures a polling trigger on `status = "Dev"`, workflow runs whenever an issue enters that column, moves it to "Review" when done.

## Phase 5 — Workflow templates

Ship starter templates so users don't face an empty canvas.

- [ ] `/templates/` directory with JSON template files.
- [ ] `GET /api/templates` endpoint: reads `/templates/*.json`, returns list.
- [ ] `POST /api/workflows/from-template/:templateId`: creates a new Workflow from a template.
- [ ] UI: "Create from template" flow on workflow creation — picker with name, description, category.
- [ ] Connection binding UI: prompt user to bind template credential placeholders to real `WorkflowConnection`s before save.
- [ ] Ship v1 templates: `analyze`, `develop`, `pr-review`.

**Exit criteria**: new user clones the repo, starts Conduit, picks the `analyze` template, binds their GitHub connection, runs it on a real issue.

## Phase 6 — More presets, polish, ship

- [ ] MCP presets for Slack, Discord, PostgreSQL, Brave Search.
- [ ] Run history page, run search/filter.
- [ ] Credential rotation UX.
- [ ] Janitor cron for workspace cleanup + log retention (30-day TTL on `ExecutionLog`).
- [ ] Documentation: user guide, MCP server setup guide.

**Exit criteria**: feature-complete v1. Ship.

## Phase 7+ — Later

Not committed, in rough priority order:
- Platform abstraction layer for triggers (GitLab boards, Jira boards) — GitHub is the first implementation, the trigger system is designed for multi-platform from the start
- Expose Conduit workflows as MCP tools (so other agents can invoke workflows)
- Custom agent provider SDK
- Multi-tenant + RBAC
- Workflow versioning + rollback
- Agent session resumability (if providers ever support it)
- Per-run container isolation for MCP server processes
- Race condition mitigation (concurrent workflows triggered on the same issue from fast board column moves)

## Explicitly deferred

- Custom tool registry / proprietary tool format — MCP is the standard
- Visual variable picker with upstream field introspection — agents read `.conduit/` files directly
- Multi-trigger workflows — one trigger per workflow in v1
