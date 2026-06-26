# Repo Analysis — component-based review-workflow suggestions

Point Conduit at a connected repo and get back a set of **suggested, ready-to-import review workflows** — one per component the repo actually has, each diff-scoped to that component with reviewer domains and a cadence tailored to it. Turns "set up periodic reviews" from manual canvas work into "analyze → review suggestions → import the ones you want."

The analysis is connection-scoped: it runs against a repo [`Connection`](./connections.md), produces a multi-workflow [template bundle](./templates.md), and imports through the existing instantiate path with the repo pre-bound.

## Why a dedicated Temporal workflow

The Conduit-definition interpreter (`apps/worker/src/workflows/agent-workflow.ts`) topo-sorts a *static* node DAG — it can't fan out to N-unknown components. A purpose-written Temporal workflow (`repoAnalysisWorkflow`) does dynamic fan-out natively while keeping Temporal's durability, retry, and crash recovery.

It reuses the agent-execution substrate at the **activity** level — `runAgentNode` (see [agent-execution.md](./agent-execution.md)) — rather than reimplementing provider invocation, workspace setup, and `.conduit/` capture. Because `runAgentNode` writes `NodeRun` rows keyed to a `WorkflowRun.id`, the analysis **mints an internal run** to host its agent executions.

## The internal run + hidden SYSTEM workflow

`runAgentNode` needs a `WorkflowRun` to write `NodeRun`s against, and a `WorkflowRun` needs a parent `Workflow` (FK, same-org invariant). So each org gets **one hidden `SYSTEM`-kind `Workflow`** (`Workflow.kind`, see [data-model.md](../data-model.md)) that exists only to host analysis runs. It is lazily created once per org, carries a trivially-valid stub `definition`, and is **filtered out of every user-facing workflow list/get/validate path**. The user never sees the internal run — only a coarse `Analyzing… → Suggestions ready` state on the connection.

The user-facing lifecycle lives on `RepoAnalysis` (`status` + `phase`), **owned by the workflow** and independent of the internal `WorkflowRun.status`. The latest `RepoAnalysis` row per connection drives the badge and the gallery.

## The analysis adapter

`runAgentNode` normally receives inputs the interpreter builds (`triggers`, `triggerEvent`, a workspace-populated node). Since analysis bypasses the interpreter, the workflow forges these via a thin, named contract in `packages/shared/src/analysis/adapter.ts` — **deliberate documented stubs, not ad-hoc forging**:

- a synthetic `analysis` `TriggerEvent` (`mode: 'scheduled'`, `repo` populated, issue/PR fields absent — documented N/A);
- a single-trigger `TriggerConfig[]` carrying the repo `connectionId` + default branch (the `cron` fields are inert filler — this trigger is never registered as a Temporal Schedule);
- an empty MCP set (analyzer agents only inspect; generated workflows carry their own MCP at import).

If the stubs grow awkward, the planned follow-up is to extract a lower-level `runSingleAgent` core shared by both paths.

The analyzer agents (`Discover`, `Design`) are **not** user-editable canvas presets — their prompts and `AgentConfig`s are inlined in code (`apps/worker/src/workflows/repo-analysis-nodes.ts`), a pure module safe for the V8 sandbox.

## Pipeline

```
cloneAnalysisWorkspace   prime the base bare clone, probe default branch
        │
        ▼
   Discover  (1 claude agent, fixed-branch on default branch)
        │    writes .conduit/ComponentManifest.json  ─── readComponentManifest (Zod) ──┐
        │                                                                               │ bad/missing
        │◀──────────────────── bounded retry (≤3 agent runs) ───────────────────────────┘
        ▼
   Design fan-out  (N claude agents, ≤12 concurrent, batched)
        │    each inherits Discover's worktree as a read-only branched worktree
        │    writes .conduit/WorkflowDraft.json   ─── readWorkflowDraft (Zod) ── bounded retry
        │    a component that never produces a valid draft is DROPPED, not fatal
        ▼
   Assemble  (pure code) — assembleSuggestionBundle → validated TemplateFile
        │    persist resultBundle + droppedComponents on RepoAnalysis (READY / FAILED)
        ▼
   cleanupRun  (finally — tears down workspace on success and failure)
```

Phase transitions (`DISCOVER → DESIGN → ASSEMBLE`) are written via `updateAnalysisPhase` so the progress card has a signal without reading hidden `NodeRun` rows.

**Structured agent output.** Both analyzer agents emit a machine-read **JSON artifact** at a fixed workspace path (`ComponentManifest.json` / `WorkflowDraft.json`) — distinct from the markdown `.conduit/<Node>.md` summary the runtime captures. A read activity Zod-validates the file; any failure (missing, bad JSON, schema mismatch) throws so the workflow's own bounded-retry loop re-runs the agent. Freeform markdown can't be reliably parsed by orchestration code. (A structured-output tool replacing this convention is a deferred follow-up.)

**Fan-out is `allSettled`-style, never all-or-nothing.** A single component failing after its retries is recorded in `droppedComponents` and surfaced in the gallery — never silently truncated — rather than sinking the whole analysis. Overflow beyond the concurrency cap runs in subsequent batches.

**Worktree caveat.** Design nodes branch read-only worktrees off Discover's still-live `fixed-branch` worktree. Discover's worktree heartbeat stops when its activity returns, so a *concurrent* analysis on the same repo+default-branch could, on an eviction-recovery path, judge Discover's worktree stale and remove it — failing (and dropping) the remaining Design nodes. Narrow trigger; the proper fix is run-scoped worktree heartbeating, tracked as a follow-up.

## The reviewer-domain catalog

A bounded data table (`packages/shared/src/analysis/reviewer-domains.ts`) maps a stable `domain key → { name, presetId: 'code-analyst', instructionsAppend }` — e.g. `security`, `quality`, `refactor`, `performance`, `a11y`, `bundle-size`, `api-contract`, `breaking-change`. The Design agent **selects keys only**; the catalog owns the prose. This keeps generated review prompts deterministic and reviewable rather than agent-authored. Mirrors the static-table pattern of `mcp/presets.ts`.

## Assemble — generated workflow shape

`assembleSuggestionBundle` (pure, `packages/shared/src/analysis/assemble.ts`) stitches surviving drafts into one multi-workflow `TemplateFile`, wired exactly like `templates/nightly-review.json` but scoped per component:

```
Trigger (cron) → Scope → [one code-analyst per selected domain] → Publisher
```

- **Scope** carries an `instructionsAppend` that scopes the review to the component's path glob(s) **and states the diff window in prose** ("the last 24 hours / 7 days / 30 days") derived from the chosen cadence — there's no typed diff-window field today, so the window rides on prose to stay aligned with cron (a first-class field is a deferred follow-up).
- Each **domain node** injects the catalog's `instructionsAppend` onto the `code-analyst` preset. A draft mapping to zero known domains is dropped (lands in `droppedComponents`).
- **Publisher** is label-gated only (publishes issues + `conduit-*` labels, no board status), with a severity gate that skips `low` findings — so generated workflows need only the repo connection.

The bundle carries the `<github-repo>` placeholder (same alias `nightly-review` uses) so it flows through the existing import path. Validation is against `templateFileSchema`; a structural failure throws (the whole analysis fails rather than persisting an unimportable bundle). Generated workflows import **paused-on-create** (`isActive: false`) — they fire only once the user activates them.

## API

Both routes live on `ConnectionsController`; logic in `apps/api/src/modules/connections/connection-analysis.service.ts`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/connections/:id/analyze` | Mint the internal run + `RepoAnalysis`, start `repoAnalysisWorkflow`, return `{ analysisId }`. `400` if the connection isn't repo-scoped, `404` for a cross-org id, **`409`** if an analysis is already in progress for the connection. |
| `GET` | `/connections/:id/analysis` | Latest analysis for the connection — `status`, `phase`, `resultBundle`, `droppedComponents`, `error`. Drives the badge + progress card + gallery. |

**Concurrency guard.** Mint runs inside a `$transaction` holding a **per-connection Postgres advisory lock** (`pg_advisory_xact_lock`), so two racing `analyze()` calls serialize and the second sees the first's `PENDING` row → `409`. A plain find-then-create would let both pass.

**Start-failure handling.** Only a *start* failure tears down the minted rows (marks them `FAILED`); a post-start persistence hiccup (writing Temporal handle ids back) is best-effort and must not fail an analysis that's already executing.

## Web

`apps/web/src/components/settings/ConnectionsSection.tsx` adds an **Analyze repo** action on repo connections → a thin progress card mapping `RepoAnalysis.phase` to coarse labels (no raw logs) → a **Suggestions ready** badge. The card polls `GET /connections/:id/analysis` (no notification system in v1).

`SuggestionsGalleryDialog.tsx` is a read-only gallery over the READY bundle — one card per suggested workflow (name, what it reviews, proposed cadence, why), select/deselect (all on by default), and **Import selected** over the template-import endpoint with the repo placeholder pre-bound to the analyzed connection → one-click import. Non-empty `droppedComponents` render a "Couldn't analyze" note.

## Out of scope (v1)

Re-run / delta detection (v1 regenerates; user dedupes via select/deselect), a notification system (badge only), board-aware generated workflows, an Assemble codex "skeptic" node, template parameters (generated workflows are concrete), and auto-create/activate without the human-gated gallery.
