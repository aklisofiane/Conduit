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

The analyzer agents (`Discover`, `Design`) are **not** user-editable canvas presets — their prompts and `AgentConfig`s are inlined in code (`apps/worker/src/workflows/repo-analysis-nodes.ts`), a pure module safe for the V8 sandbox. The Design dispatch additionally gets three internal skills staged into its worktree to guide the prose it authors (see [Skill-guided prose authoring](#skill-guided-prose-authoring)).

## Pipeline

```
cloneAnalysisWorkspace   prime the base bare clone, probe default branch
        │
        ▼
   Discover  (1 claude agent, fixed-branch on default branch)
        │    writes .conduit/ComponentManifest.json  ─── readComponentManifest (Zod) ──┐
        │                                                                               │ bad/missing/exceeds cap
        │◀──────────────────── bounded retry (≤3 agent runs) ───────────────────────────┘
        ▼
   Design fan-out  (N claude agents, ≤12 concurrent, batched)
        │    each inherits Discover's worktree as a read-only branched worktree
        │    + 3 internal skills staged in to guide the authored prose
        │    writes .conduit/WorkflowDraft.json   ─── readWorkflowDraft (Zod) ── bounded retry
        │    a component that never produces a valid draft is DROPPED, not fatal
        ▼
   Assemble  (pure code) — assembleSuggestionBundle → validated TemplateFile
        │    persist resultBundle + droppedComponents on RepoAnalysis (READY / FAILED)
        ▼
   cleanupRun  (finally — tears down workspace on success and failure)
```

Phase transitions (`DISCOVER → DESIGN → ASSEMBLE`) are written via `updateAnalysisPhase` so the progress card has a signal without reading hidden `NodeRun` rows.

**Structured agent output.** Both analyzer agents emit a machine-read **JSON artifact** at a fixed workspace path (`ComponentManifest.json` / `WorkflowDraft.json`) — distinct from the markdown `.conduit/<Node>.md` summary the runtime captures. A read activity Zod-validates the file; any failure (missing, bad JSON, schema mismatch) throws so the workflow's own bounded-retry loop re-runs the agent. Freeform markdown can't be reliably parsed by orchestration code. (A structured-output tool replacing this convention is a deferred follow-up.) The Discover output is additionally bounded by a `MAX_COMPONENTS = 50` Zod constraint on `componentManifestSchema` — an oversized manifest fails validation the same way a malformed one does, triggering a Discover retry with the cap explicitly stated in the agent prompt.

**Fan-out is `allSettled`-style, never all-or-nothing.** A single component failing after its retries is recorded in `droppedComponents` and surfaced in the gallery — never silently truncated — rather than sinking the whole analysis. Overflow beyond the concurrency cap runs in subsequent batches.

**Worktree caveat.** Design nodes branch read-only worktrees off Discover's still-live `fixed-branch` worktree. Discover's worktree heartbeat stops when its activity returns, so a *concurrent* analysis on the same repo+default-branch could, on an eviction-recovery path, judge Discover's worktree stale and remove it — failing (and dropping) the remaining Design nodes. Narrow trigger; the proper fix is run-scoped worktree heartbeating, tracked as a follow-up.

## Skill-guided prose authoring

The Design agent **authors** each component's review prose — a tailored Scope prompt and a set of named reviewers — rather than picking keys from a fixed catalog. This is what makes a component named `API` and one named `Web` get genuinely different reviews instead of byte-identical prose stamped from a shared table. (The earlier `reviewer-domains.ts` catalog is gone; its lenses live on as *examples* inside the `reviewer-authoring` skill below.)

What the agent authors is bounded by **three internal, non-discovered skills** staged into its worktree (`packages/agent/src/analysis/skills/<id>/SKILL.md`):

| Skill | Guides the agent on |
|---|---|
| `draft-format` | the exact `WorkflowDraft` JSON shape, field-by-field, with the reviewer-name charset rule and a worked example |
| `scope-authoring` | writing a strong, component-tailored Scope prompt and how the ScopeManifest routes change sets to reviewers |
| `reviewer-authoring` | authoring component-specific reviewers, with a menu of example lenses (security, quality, performance, a11y, api-contract, breaking-change…) to draw from, adapt, or extend |

These skills are **internal**: they are staged directly from the agent package source and are **never** walked by `discoverSkills` (which only scans `~/.claude/skills`, plugin roots, and repo/cwd roots), so they never appear in `GET /skills` or the canvas skill picker. Topology stays fixed and code-owned (see Assemble below) — the agent owns only the prose.

**Staging mechanism.** `installAnalysisSkillsIntoWorkspace` (`packages/agent/src/skill/analysis-skills.ts`) copies the three skill subdirs into the workspace's provider skills dir (`.claude/skills` / `.agents/skills`), the same convention the SDKs auto-discover. The bundle is resolved from the package's `src` tree, not `dist/` — `tsc --build` compiles `.ts` but does not copy the `.md` files, so the resolver walks up to the package root and reads from `src` (works under both `tsx`/vitest and the built worker). Staging is gated by a `stageAnalysisSkills` boolean on `runAgentNode`, set by `repoAnalysisWorkflow` for the **Design dispatch only** (Discover authors no prose). The bundled-dir resolution and copy are filesystem I/O, so they live in the activity, keeping the workflow V8-sandbox-safe.

## Assemble — generated workflow shape

`assembleSuggestionBundle` (pure, `packages/shared/src/analysis/assemble.ts`) stitches surviving drafts into one multi-workflow `TemplateFile`, wired exactly like `templates/nightly-review.json` but scoped per component:

```
Trigger (cron) → Scope → [one reviewer node per authored reviewer] → Publisher
```

The division of labor is the key invariant: **the agent authors the prose, the code owns the topology and the I/O contract.** Each draft carries authored `scopeInstructions` and a `reviewers[]` list (`{ name, instructions }`, at least one); assemble keeps the fixed shape above and *appends* deterministic glue onto that authored prose. Presets supply only provider/model.

- **Scope** uses the authored `scopeInstructions`, onto which assemble appends the mechanical glue: the component's path glob(s), the **diff window stated in prose** ("the last 24 hours / 7 days / 30 days") derived from the chosen cadence, the `## <ReviewerName>` headings to write into `.conduit/ScopeManifest.md`, and the `NO_CHANGES` short-circuit. (There's no typed diff-window field today, so the window rides on prose to stay aligned with cron — a first-class field is a deferred follow-up.)
- Each **reviewer node** uses that reviewer's authored `instructions`, onto which assemble appends the contract glue: read your `## <name>` section of the ScopeManifest, and write findings to `.conduit/<name>.md` in the fixed `## Findings` / `Severity:` format the Publisher's gate parses. Reviewer names are sanitized into safe, unique node ids (`agent-<slug>`); a draft whose names all collapse to empty/duplicate slugs is dropped (lands in `droppedComponents`).
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
