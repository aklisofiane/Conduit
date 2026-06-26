# Phase 3 smoke — parallel fan-out, merge-back, sibling summaries

Exercises the Phase 3 golden path: a diamond graph
`Triage → (Fix ‖ Doc) → Review` where the two middle nodes run in parallel
off branched worktrees, merge back into the upstream, and propagate their
`.conduit/<Node>.md` summaries downstream. Prose-only — Claude drives
Playwright via MCP.

## Setup

1. Ensure the dev stack is up: `npm run infra:up`.
2. Ensure the database is migrated: `npm run db:push`.
3. Start the apps in separate terminals: `npm --workspace @conduit/api dev`,
   `npm --workspace @conduit/worker dev`, `npm --workspace @conduit/web dev`.
   Export `CONDUIT_PROVIDER=stub` for the **api** and **worker** processes so
   the parallel run is deterministic (no real LLM calls).
4. Open the web app (typically http://localhost:5173).

## Steps

1. Create a new workflow called `Phase 3 smoke — Parallel`. Navigate to its
   canvas.
2. Add a GitHub credential + connection (`alias = github-main`,
   `owner = acme`, `repo = shop`) if not already present.
3. Configure the trigger node: Platform GitHub, Connection github-main,
   Mode **Webhook**, event `issues.opened`, Active checked. Save.
4. Build the diamond with four agent nodes and wire the edges:
   - `Triage` (instructions: "Classify the issue.")
   - `Fix` (instructions: "Apply the fix.") — inherits from Triage
   - `Doc` (instructions: "Update the changelog.") — inherits from Triage
   - `Review` (instructions: "Review combined work.")
   - Edges: `Triage → Fix`, `Triage → Doc`, `Fix → Review`, `Doc → Review`.
5. Confirm the canvas renders the diamond: Triage fans out to two siblings
   that both converge on Review. Save the workflow and activate it.

## Run detail page

6. Start a manual run with an issue reference like `7 / Parallel work`.
7. Open the run in the run detail page. The left rail lists all four nodes:
   `Triage`, `Fix`, `Doc`, `Review`.
8. `Fix` and `Doc` enter **RUNNING** within the same group (they are not
   gated behind one another) — i.e. the second does not wait for the first
   to finish before starting.
9. Select `Review` after the run completes. Its **Summary** tab (or the
   timeline context) reflects that both siblings' summaries reached it —
   `Review` was able to see `.conduit/Fix.md` and `.conduit/Doc.md`
   (merge-back + summary propagation happened upstream of it).
10. The run header reaches **Succeeded / COMPLETED**.

## Assertions on visible DOM text

- Canvas shows a diamond: one node fanning out to two, both converging on a
  fourth.
- Run detail left rail lists `Triage`, `Fix`, `Doc`, `Review`.
- `Fix` and `Doc` both reach RUNNING/COMPLETED without a strict A-then-B
  ordering between them (parallel group).
- Run header reaches `COMPLETED` (Succeeded) for the happy-path run.
