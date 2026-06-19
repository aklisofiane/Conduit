# Plans

Phased rollout. Each phase ends with something runnable end-to-end.

## Shipped (Phases 0–6) ✅

Phases 0–6 are complete. Per-bullet exit criteria now live in the design-docs and the `test/e2e/phaseN-*.test.ts` suite; this table is the changelog residue. The detail behind each row is in the linked design-doc / subsystem; the test path is the executable proof.

| Phase | Outcome | E2E proof |
|---|---|---|
| 0 — Spec & scaffolding | Monorepo (npm workspaces + Turborepo), Docker compose stack, `@conduit/shared` core types + Zod schemas, `@conduit/database` Prisma schema. `npm run db:push` works. | — |
| 1 — Single agent, manual run | `@conduit/agent` provider interface + Claude/Codex providers + workspace manager; `apps/api` (NestJS) CRUD + `RunsGateway` WS + Temporal client; `apps/worker` `agentWorkflow` + `runAgentNode`; skill discovery; `apps/web` canvas + run detail. Manual "Run" later retired in favor of fast-interval polling. | — (`phase1-manual-run` removed; Phase 2 webhook E2E covers the agent + streaming pipeline) |
| 1.5 — Validation harness | `StubProvider` (real tools, fake LLM, `CONDUIT_PROVIDER=stub`); `docker-compose.test.yml` on non-dev ports + tmpfs; 4 vitest projects (unit/integration/api/e2e); Temporal test utils; E2E harness; Playwright MCP wiring; CI. `npm test` runs the full suite against an ephemeral stack in under 5 min. See [VALIDATION.md](./VALIDATION.md). | `test/e2e/harness.ts` |
| 2 — GitHub trigger + MCP + repo workspace | MCP config resolver + `POST /mcp/introspect`; full Codex provider; webhook ingestion (`POST /api/hooks/:workflowId`) with HMAC; GitHub `TriggerEvent` normalization; GitHub MCP preset; `WorkflowConnection` + `PlatformCredential` UI; custom MCP server config UI; per-tool `allowedTools` filtering. (`repo-clone` workspace kind later superseded — `ticket-branch` is the sole entry kind, derived from graph topology.) | `test/e2e/phase2-webhook-run.test.ts` |
| 3 — Multi-agent, parallel, workspace inheritance | Parallel group execution (topo sort + `Promise.all`); `inherit` workspace kind; `.conduit/` handoff summaries over multi-turn provider sessions; sequential merge-back (`mergeWorktreeActivity`, clean-merge happy path — conflicts throw `MergeConflictError` and abort); `.conduit/` copy from parallel worktrees (`copyConduitFilesActivity`); run detail per-node tabs with `NodeRun.conduitSummary` persistence. | `test/e2e/phase3-parallel-run.test.ts` |
| 4 — Polling trigger + board orchestration | Polling via Temporal Schedule (reconciled at API boot), `pollWorkflow` → `pollBoardActivity`, set-diff dedup via `PollSnapshot.matchingIds`; GitHub Projects column-move normalization (`projects_v2_item.edited` → `board.column.changed`, webhook + polling parity); trigger UI with platform/connection/mode/event/interval/`BoardRef`/filter builder. | `test/e2e/phase4-polling-run.test.ts` (+ `phase4-polling-pr-run.test.ts`) |
| 5 — Board loops (`ticket-branch`) | `ticket-branch` workspace kind (branch derivation, check-then-create, worktree setup); `TicketBranch` Prisma row + `TicketBranchStore`; push auth via per-run git credential-helper script (never in `.git/config` or remote URL); in-process base-clone path lock; deterministic Temporal workflow-ID + conflict/reuse policy → `DuplicateRunError`; `cleanupRunActivity` split (worktree wiped, remote branch preserved, unpushed-commits warning); save-time `validateWorkflowDefinition` requiring an issue-carrying trigger; resolved `conduit/*` branch in run header. See [branch-management.md](./design-docs/branch-management.md). | `test/e2e/phase5-board-loop.test.ts` |
| 6 — Workflow templates | `/templates/*.json` catalog + `GET /api/templates` (boot-validated); multi-workflow bundle schema in `@conduit/shared/template`; `POST /api/workflows/from-template/:templateId` (atomic `$transaction`, placeholder resolution, per-workflow validation, post-commit schedule upsert); "From template" picker + connection-binding UI; v1 templates (`analyze`, `develop`, `review`, `nightly-review`, `merge`). See [templates.md](./design-docs/templates.md). | `test/e2e/phase6-template-run.test.ts` |

## Phase 7 — More presets, polish, ship

- [ ] MCP presets for Slack, Discord, PostgreSQL, Brave Search.
- [~] Run history — the runs *list* shipped as an in-canvas "Runs" tab (`WorkflowRunsList`); a richer standalone history page + run search/filter is still open.
- [ ] Credential rotation UX.
- [ ] Janitor cron for workspace cleanup + log retention (30-day TTL on `ExecutionLog`).
- [ ] Documentation: user guide, MCP server setup guide.

**Exit criteria**: feature-complete v1. Ship.

## Phase 8+ — Later

Not committed, in rough priority order:
- Platform abstraction layer for triggers (GitLab boards, Jira boards) — GitHub is the first implementation, the trigger system is designed for multi-platform from the start
- Expose Conduit workflows as MCP tools (so other agents can invoke workflows)
- Custom agent provider SDK
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
