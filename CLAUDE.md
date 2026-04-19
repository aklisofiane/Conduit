# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Docs — read on demand

The spec in `docs/` is authoritative. **Don't pre-load these** — open them only when the task needs them. Use the hints below to pick the right one; `docs/INDEX.md` has the full ordered list.

- `docs/STRUCTURE.md` — when you need to find *where something lives*.
- `docs/ARCHITECTURE.md` — when you need to understand *how the pieces talk* (apps, data flow, API surface, conventions).
- `docs/data-model.md` — when touching the Prisma schema or anything reading `Workflow.definition`.
- `docs/VALIDATION.md` — when writing or debugging tests (layers, `StubProvider`, Playwright MCP).
- `docs/PLANS.md` — when it's unclear whether something is in scope for the current phase.
- `docs/design-docs/*` — when working on a specific subsystem (node system, agent execution, MCP, `.conduit/` context, branch management, templates).
- `docs/SECURITY.md`, `docs/RELIABILITY.md`, `docs/FRONTEND.md` — topical; read only when the task clearly lands there.

`README.md` has prerequisites and the one-time bootstrap.

## Commands

```bash
# Infra
npm run infra:up / infra:down / infra:logs              # dev stack
npm run test:infra:up / test:infra:down                 # test stack (separate ports, tmpfs)

# DB (Prisma — `db push` during dev, migrations later)
npm run db:push / db:generate / db:studio

# Turbo pipelines
npm run build / dev / typecheck / lint / format

# Tests (4 vitest projects, see vitest.workspace.ts)
npm test                    # full suite
npm run test:unit / test:integration / test:api / test:e2e
npx vitest run path/to/file.test.ts
npx vitest run -t "name pattern"

# Per-app dev
npm --workspace @conduit/api    dev    # :3001
npm --workspace @conduit/worker dev    # Temporal worker
npm --workspace @conduit/web    dev    # :5173
```

`pretest:e2e` builds api + worker before E2E runs.

## Things not obvious from the docs

- **Workflow sandbox.** `apps/worker/src/workflows/agent-workflow.ts` runs in Temporal's V8 sandbox — no `node:*`, no Prisma, no Redis, no provider imports. All I/O belongs in `apps/worker/src/activities/`.
- **`@conduit/shared` subpath exports.** Import from the narrow subpaths (`/agent`, `/trigger`, `/mcp`, `/workflow`, `/runtime`, `/temporal`, `/workspace`, `/skill`, `/platform`) rather than the root barrel — the web bundle tree-shakes `node:crypto` out only when consumers import narrowly.
- **Single root `.env`.** API/worker read `../../.env`; web uses `VITE_*`; `packages/database/.env` is a copy for the Prisma CLI (root npm scripts forward via `dotenv-cli`).
- **Provider selection.** `CONDUIT_PROVIDER=claude|codex|stub`. Tests use `stub` — it replays scripted events but exercises real tool execution, real workspaces, real `.conduit/` writes. No real LLM calls anywhere in the suite.

## Coding conventions

- **Match the existing directory layout.** This repo splits code into nested subdirectories by concern (e.g. `activities/`, `workflows/`, `providers/`, `shared/*` subpaths) — don't flatten. When adding new code, find the sibling module that does the closest thing and follow its shape. New features usually mean a new subdirectory, not a new top-level file.
- **Extract to `@conduit/shared` when logic is reused across apps.** If the same helper ends up in two of `apps/api`, `apps/worker`, `apps/web`, move it to the appropriate `packages/shared/src/*` subpath instead of duplicating or cross-importing between apps. Place it in the subpath that matches the concern so consumers can use the narrow imports above.
- **Watch file size as a split signal.** ~500 lines is a soft ceiling — past that, consider splitting by concern. Not a hard rule: if a file genuinely needs to be big (a cohesive state machine, a generated schema, a single algorithm), leave it. The point is to notice the smell, not to chase a line count.
