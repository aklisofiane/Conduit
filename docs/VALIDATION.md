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

### 3. API contract tests (`vitest` + supertest)

`apps/api` endpoints against a real test stack (Postgres + Temporal test env). Covers workflow CRUD, credential CRUD, webhook ingestion (HMAC verification), MCP introspection, template instantiation.

### 4. E2E tests (`vitest` harness)

The lever that makes Claude able to validate exit criteria autonomously.

Harness spins up: Postgres + Temporal + Redis + api + worker + `StubProvider`. Drives via HTTP. Asserts on DB state, WS frames, workspace filesystem, Temporal workflow history.

**Example** — Phase 1 exit criterion:
```
1. POST /workflows → create workflow with one agent node, local workspace
2. POST /workflows/:id/run → manual run
3. Connect to /runs/:id WS → collect frames
4. Await terminal frame
5. Assert: run row status = SUCCEEDED, frames include streamed agent output, workspace contains expected side effects
```

### 5. UI smoke tests (Playwright, via MCP)

**Setup**: the user configures the Playwright MCP server in Claude Code:

```
claude mcp add playwright "npx -y @playwright/mcp@latest"
```

Claude does not install or configure Playwright directly — the MCP server brings its own bundled Chromium and Playwright runtime. The smoke tests live alongside the E2E harness so both can share the same test stack.

**Usage**: when a phase adds UI surface, the author writes a short smoke script (repo path: `test/smoke/<phase>.smoke.md`) containing the golden-path interaction as plain prose. Claude reads the script, starts the dev stack (`npm run infra:up` + `npm run dev`), then drives Playwright via MCP tools to exercise the flow. Assertions are on visible DOM text, not snapshots.

One smoke per phase's golden path — the minimum that proves the UI wires up to the backend. Everything else (timeline rendering, edge cases, error states) is covered by the unit/integration/E2E layers.

**Scope limit**: smoke only. Visual regression, accessibility audits, cross-browser matrices are not in scope for v1.

**CI**: the Playwright smoke runs on `push` to main (not on every PR) — it needs a display server and is comparatively slow. See `.github/workflows/test.yml`.

## The `StubProvider`

Part of Phase 1 deliverables alongside `ClaudeProvider`.

- Same `AgentProvider` interface as real providers.
- Outputs are **scripted** per test: the test passes a `StubScript` (list of events: text chunks, tool calls, tool results, final message) and the provider replays them with configurable delays.
- Tool calls in the script can reference real tools (real file writes, real git commits) — the stub only replaces the LLM loop, not the tool execution layer. This is what makes E2E tests meaningful: they exercise the real workspace, real MCP tool paths, real `.conduit/` file writes.
- Selected via env var (`CONDUIT_PROVIDER=stub`) or per-workflow config override in tests.

## Fixtures

- **Seed workflows**: JSON files under `test/fixtures/workflows/` covering each node topology (single agent, parallel, ticket-branch, multi-trigger).
- **Seed git repos**: tarballs under `test/fixtures/repos/` containing pre-built bare repos with commit history, ready to clone locally. No GitHub network access in tests.
- **Seed trigger events**: JSON payloads for GitHub webhook events (issue opened, PR opened, PR comment, project column moved) captured from real payloads once, checked in.
- **Seed MCP servers**: a tiny in-repo stdio MCP server (`test/fixtures/mcp-stub/`) that exposes a handful of tools with predictable behavior, used instead of the real `@modelcontextprotocol/server-github` in tests.

## Temporal testing specifics

- `TestWorkflowEnvironment.createTimeSkipping()` for workflow-level tests — skips sleeps, schedule intervals, retry backoffs.
- `MockActivityEnvironment` for activity-level tests — isolates activity logic from workflow orchestration.
- Real `Worker` + real Temporal server (via testcontainers or local compose) for full E2E — slower but catches wiring bugs.
- Workflow-ID uniqueness (Phase 5 `ticket-branch`): explicit test for `WorkflowIdConflictPolicy = FAIL` path — start twice concurrently, assert second start rejected, assert first completes cleanly.

## What we don't test

- Real Anthropic/OpenAI model behavior. Out of scope; covered by manual smoke runs before release.
- Real GitHub webhook delivery. HMAC verification is tested; delivery reliability is GitHub's problem.
- Real MCP server binaries (`@modelcontextprotocol/server-github` etc.). The discovery + config path is tested against the stub MCP server; third-party server correctness is their problem.
- Performance / load. Not in scope for v1; revisit post-ship.

## Per-phase validation checklist

Every phase in [PLANS.md](./PLANS.md) lands with:
1. Unit + integration tests for new package code.
2. API contract tests for any new endpoints.
3. At least one E2E test covering the phase's exit criterion.
4. At least one Playwright smoke test (via MCP) if the phase adds UI surface.

A phase is not "done" until these pass in CI.

## CI

- Every PR: unit + integration + API + E2E against ephemeral stack.
- Playwright smoke: optional on PR (slow), required on main.
- Test stack: `docker compose -f docker-compose.test.yml up` — separate from dev compose, different ports, ephemeral volumes.
