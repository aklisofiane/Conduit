# Validation

How we prove the system works. The goal: every exit criterion in [PLANS.md](./PLANS.md) is covered by a test Claude can run autonomously — no LLM calls in the loop, no manual UI clicking, no "looks right to me."

## Principles

- **No real LLM calls in tests.** Real agent runs are slow, nondeterministic, and expensive. A test suite that hits Anthropic/OpenAI is not a test suite we can run on every change.
- **Deterministic workspaces.** Git operations use real git (not mocked), but on ephemeral temp dirs seeded from fixtures. No network for git — remotes are local bare repos.
- **Real Temporal, real Postgres, real Redis.** Dockerized in CI, test env locally. Mocking these hides the actual failure modes (retry semantics, transaction boundaries, pub/sub ordering).
- **Tests own their state.** Every test creates its own workflow/credential/run rows and tears them down. No shared fixtures that leak between tests.
- **One test per phase exit criterion.** If a phase claims "user does X and sees Y," there is an E2E test that does exactly that and asserts on Y.

## Test layers

### 1. Unit tests (`vitest`)

Per-package, fast, no I/O.
- `@conduit/shared`: schema validation, type guards.
- `@conduit/agent`: workspace path derivation, branch name slugging, MCP config resolution with credential substitution, provider interface contract.
- `@conduit/database`: none — Prisma is tested via integration.

### 2. Integration tests (`vitest` + testcontainers or dockerized test env)

Per-package, real external deps, slower.
- `@conduit/database`: Prisma migrations, query correctness against real Postgres.
- `@conduit/agent/workspace`: real `git worktree add`, branch derivation, cleanup, lock contention (`ticket-branch` concurrent starts).
- `apps/worker` activities: run each activity in isolation against `@temporalio/testing` MockActivityEnvironment, real Postgres, real Redis, `StubProvider`.
- `apps/worker` workflows: `@temporalio/testing` TestWorkflowEnvironment with time-skipping, assert on activity call order, retry behavior, signal/cancellation handling.

### 3. API contract tests (`vitest`, the `api` project)

`apps/api` service-layer contracts against a real test stack (Postgres + Redis, brought up by `npm run test:infra:up`). Each spec in `apps/api/test/contract/` opens a fresh `PrismaClient` against the test DB, seeds fixtures, instantiates the Nest service directly (e.g. `new CredentialsService(prisma)`), and tears down its own rows in `afterEach` — **no `@nestjs/testing`, no `supertest`, no running HTTP server**. The contract under test is org-scoping and data isolation, asserted at the service boundary rather than over the wire.

Coverage today: cross-org rejection for every tenant-scoped service (`credentials-`, `connections-`, `runs-`, `trigger-`, `workflows-`, `provider-configs-cross-org.test.ts`), the `@OrgId()` decorator (`org-id-decorator.test.ts`), audit logging + rate limit (`audit-log.test.ts`, `audit-rate-limit.test.ts`), the frozen Temporal slug (`workflows-temporal-slug.test.ts`), and template platform swaps (`templates-platform-swap.test.ts`).

### 4. E2E tests (`vitest` harness)

The lever that makes Claude able to validate exit criteria autonomously.

Harness spins up: Postgres + Temporal + Redis + api + worker + `StubProvider`. Drives via HTTP. Asserts on DB state, WS frames, workspace filesystem, Temporal workflow history. The harness pins `CONDUIT_RUNNER_MODE=docker` so e2e always exercises the real `agent-runner` image, even though local deployments default to host runner mode.

**Example** — webhook-triggered run:
```
1. POST /workflows → create workflow with one agent node, local workspace
2. POST /api/hooks/:workflowId → deliver a webhook event
3. Connect to /runs/:id WS → collect frames
4. Await terminal frame
5. Assert: run row status = SUCCEEDED, frames include streamed agent output, workspace contains expected side effects
```

Beyond the per-phase suites (`phase2`–`phase6`), the harness also drives the auth and multi-tenant surface end-to-end: `auth-cookie-flow.test.ts` (sign-up/sign-in → session cookie → guarded route), `authz-enforcement.test.ts` (guards reject the unauthenticated), and `cross-org-isolation.test.ts` (one org can't read another's rows over HTTP/WS — the wire-level companion to the service-layer contract tests above).

### 5. UI smoke tests (Playwright, via MCP)

**Setup**: the user configures the Playwright MCP server in Claude Code:

```
claude mcp add playwright "npx -y @playwright/mcp@latest"
```

Claude does not install or configure Playwright directly — the MCP server brings its own bundled Chromium and Playwright runtime. The smoke tests live alongside the E2E harness so both can share the same test stack.

**Usage**: when a phase adds UI surface, the author writes a short smoke script (repo path: `test/smoke/<phase>.smoke.md`) containing the golden-path interaction as plain prose. Claude reads the script, starts the dev stack (`npm run infra:up` + `npm run dev`), then drives Playwright via MCP tools to exercise the flow. Assertions are on visible DOM text, not snapshots.

One smoke per phase's golden path — the minimum that proves the UI wires up to the backend. Everything else (timeline rendering, edge cases, error states) is covered by the unit/integration/E2E layers. The same convention covers cross-cutting UI: `auth.smoke.md` (sign-up/sign-in/sign-out) and `org-switching.smoke.md` (active-org switch) sit alongside the `phase*.smoke.md` scripts.

**Scope limit**: smoke only. Visual regression, accessibility audits, cross-browser matrices are not in scope for v1.

**CI**: the Playwright smoke runs on `push` to main (not on every PR) — it needs a display server and is comparatively slow. See `.github/workflows/test.yml`.

## The `StubProvider`

Part of Phase 1 deliverables alongside `ClaudeProvider`.

- Same `AgentProvider` interface as real providers.
- Outputs are **scripted** per test: the test passes a `StubScript` (list of events: text chunks, tool calls, tool results, final message) and the provider replays them with configurable delays.
- Tool calls in the script can reference real tools (real file writes, real git commits) — the stub only replaces the LLM loop, not the tool execution layer. This is what makes E2E tests meaningful: they exercise the real workspace, real MCP tool paths, real `.conduit/` file writes.
- Selected via env var (`CONDUIT_PROVIDER=stub`) or per-workflow config override in tests.

## Fixtures

The fixture tree (seed workflows, MCP stub, GitHub event payloads) is mapped in [STRUCTURE.md > test/](./STRUCTURE.md#test). Tests get bare git remotes from local clones via `CONDUIT_TEST_REMOTE_BASE` (the harness builds them on the fly — `test/fixtures/repos/` is reserved, not a tarball store) so there's no GitHub network access. Two pieces carry behavior worth spelling out:

- **Mock GitHub GraphQL**: `test/e2e/mock-github.ts` stands up a local HTTP server that serves canned payloads for the queries `pollBoardActivity` issues — Projects v2 items (`projectBoardResponse`), repo open PRs (`repositoryPullRequestsResponse`), and repo open issues — so each polling source/scope combo is drivable without GitHub. `startMockGithubGraphql()` returns `{ url, enqueue, close }`; the URL is injected into the worker subprocess via `GITHUB_GRAPHQL_URL`. Used by the Phase 4 E2Es (`phase4-polling-run.test.ts`, `phase4-polling-pr-run.test.ts`) to drive `pollBoardActivity` deterministically across cycles.
- **PR-scope branch seeding**: `Harness.seedRemoteBranch(owner, repo, branch)` pushes `branch` onto the bare remote (one synthetic commit on top of `main`) and refreshes the worker's base-clone mirror so `ticket-branch`'s PR arm can `git worktree add <pr.headRef>` without a network fetch. The PR-scope polling fixture is `test/fixtures/workflows/phase4-polling-pr.json` — `mode.scope: 'pull_requests'` with a `pr_state` filter.

## Temporal testing specifics

- `TestWorkflowEnvironment.createTimeSkipping()` for workflow-level tests — skips sleeps, schedule intervals, retry backoffs.
- `MockActivityEnvironment` for activity-level tests — isolates activity logic from workflow orchestration.
- Real `Worker` + real Temporal server (via testcontainers or local compose) for full E2E — slower but catches wiring bugs.
- Workflow-ID uniqueness (Phase 5 `ticket-branch`): explicit test for `WorkflowIdConflictPolicy = FAIL` path — start twice concurrently, assert second start rejected, assert first completes cleanly. Board-loop iteration is covered end-to-end by `test/e2e/phase5-board-loop.test.ts`, which drives Worker → Critic → Worker against a local bare repo via `CONDUIT_TEST_REMOTE_BASE` and asserts iteration N+1 sees iteration N's commits.
- Polling schedules (Phase 4): drive ticks deterministically via `ScheduleHandle.trigger()` rather than waiting on wall-clock intervals. Schedule-id lookups use `pollScheduleId(workflowId)` from `@conduit/shared/temporal`.

## What we don't test

- Real Anthropic/OpenAI model behavior. Out of scope; covered by manual smoke runs before release.
- Real GitHub webhook delivery. HMAC verification is tested; delivery reliability is GitHub's problem.
- Real MCP servers (`https://api.githubcopilot.com/mcp/`, npm binaries, etc.). The discovery + config path is tested against the stub MCP server; third-party server correctness is their problem.
- Performance / load. Not in scope for v1; revisit post-ship.

## Per-phase validation checklist

Every phase in [PLANS.md](./PLANS.md) lands with:
1. Unit + integration tests for new package code.
2. API contract tests for any new endpoints.
3. At least one E2E test covering the phase's exit criterion.
4. At least one Playwright smoke test (via MCP) if the phase adds UI surface.

A phase is not "done" until these pass — CI gates the cheap layers, the rest run locally before merge.

## CI

- **CI (every PR + push to main)**: typecheck (covers `apps/`, `packages/`, and `test/`), lint, unit. That's it — fast, deterministic, no docker.
- **Local before merge**: integration + API contract + E2E. Bring up the test stack with `npm run test:infra:up` (separate from dev compose, different ports, ephemeral tmpfs volumes), then `npm run test:integration` / `test:api` / `test:e2e`.
- **Playwright smoke**: local-only, run via MCP when touching UI surface.

E2E was previously gated on CI but reliably hung on GHA's 2-vCPU runners (shared docker I/O + Temporal worker concurrency contention). Locally it's fast and reliable, which is where it belongs.
