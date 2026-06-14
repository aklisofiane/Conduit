# Workflow Templates

Pre-built workflow blueprints shipped with Conduit to help users get started quickly. Templates are starting points, not runtime entities.

## How it works

1. Templates live as JSON files in `/templates/` at the repo root. They reference reusable agent prompts from `/agent-presets/*.md` (markdown with YAML frontmatter) — see [agent-presets.md](./agent-presets.md).
2. `TemplatesService.onModuleInit` reads the directory **once at API boot** via the shared `loadJsonDir` helper (`apps/api/src/common/load-json-dir.ts`), validates each file against the input Zod schema in `@conduit/shared/template`, expands `presetId` references via `expandTemplate`, re-validates against the runtime schema, then caches the entries. Files that fail any step (parse, input schema, unknown preset, post-expansion schema) are logged and skipped. **Editing a template on disk requires an API restart** to take effect.
3. `GET /api/templates` returns the cached list — `{ id, name, description, category, workflowCount, placeholders }`. `placeholders` is the deduplicated list of `<alias>` strings the bundle references, used by the UI to build the binding form.
4. The user picks a template in the UI (`TemplatePickerDialog` on the workflow list) and supplies one `TemplateBinding` per placeholder.
5. `POST /api/workflows/from-template/:templateId` materializes any `new`-mode bindings into global `Connection` rows once, resolves the placeholders to those (or to `existing` connection ids), runs `validateWorkflowDefinition` per resolved workflow, and creates all workflow rows in a single Prisma `$transaction`. Polling poll schedules upsert after commit.

Templates are **static seed data**, not first-class DB entities. They never link back to the workflows created from them. Editing a template file doesn't affect existing workflows.

A template can contain **one or more workflow definitions**. All shipped templates are single-workflow (one-element `workflows` array). The multi-workflow capability remains in the schema for user-authored bundles that need it.

## File shape

```json
{
  "id": "analyze",
  "name": "Analyze",
  "description": "Review a new issue's intent and propose an implementation approach based on the source code.",
  "category": "triage",
  "workflows": [
    {
      "name": "Analyze",
      "description": "...",
      "definition": {
        "triggers": [ /* TriggerConfig — length 1 in v1 */ ],
        "nodes": [ /* TemplateAgentInput[] — see "Agent shape" below */ ],
        "edges": [ /* Edge[] — Edge.from may reference a trigger or an agent */ ],
        "mcpServers": [ /* WorkflowMcpServer[] */ ],
        "ui": { /* CanvasUI — node positions, viewport */ }
      }
    }
  ]
}
```

Each entry's `definition` matches `Workflow.definition` in the DB **after preset expansion**. Two schemas govern this: `templateInputFileSchema` validates the on-disk shape (where agents may use `presetId`), and `templateFileSchema` validates the post-expansion shape (concrete `instructions`/`model`/`provider`). Connection placeholder strings pass structural validation because they satisfy `z.string().min(1)`; semantic validation (`validateWorkflowDefinition`) runs only after placeholder resolution, on the per-workflow path. The template's top-level `name`/`description`/`category` describe the bundle; each entry's `name`/`description` become the created `Workflow` row's fields.

**Category** is one of `triage | develop | review | merge` (`packages/shared/src/template/schema.ts`) — a display-only hint for grouping in the picker.

### Agent shape

Each `nodes[]` entry is a `TemplateAgentInput` (`packages/shared/src/template/schema.ts`). For each agent, the author chooses **one** of two shapes:

```json
// Preset reference (preferred — keeps prompts in one place)
{
  "id": "agent-research",
  "name": "Research",
  "presetId": "research",
  "instructionsAppend": "Optional workflow-specific addendum.",
  "mcpServers": [...],
  "skills": [...],
  "workspace": { ... }
}

// Inlined (legacy / one-off)
{
  "id": "agent-research",
  "name": "Research",
  "provider": "claude",
  "model": "claude-opus-4-6",
  "instructions": "You are a Research agent...",
  "mcpServers": [...],
  "skills": [...],
  "workspace": { ... }
}
```

Rules enforced by `templateAgentInputSchema.superRefine`:

- `presetId` is mutually exclusive with the literal `provider` / `model` / `instructions` triple. Either set `presetId` or set all three.
- `instructionsAppend` requires `presetId` (it's appended after the preset's prompt with `\n\n`).
- An unknown `presetId` causes the whole template file to be **skipped at load time** with a warning. The template won't appear in `GET /templates`.

Workflow-scoped fields (`mcpServers`, `skills`) are always set per-agent regardless of which shape is used — presets deliberately don't carry them. (Workspaces aren't in this list — they're derived from edges at load time, not authored.) See [agent-presets.md](./agent-presets.md).

## Label-gated signaling

The board-driven pipeline (`analyze` → `develop` → `review` → `merge`) gates AI work on `conduit-*` labels, not board status. The rule:

- **Labels gate AI-to-AI handoffs.** `conduit-dev`, `conduit-review`, and `conduit-merge` are the machine signals that a workflow should act. Triggers filter on these labels (or platform state like `pr_state`); board status is never load-bearing for an AI handoff. This makes the convention work identically on GitHub and GitLab, lets AI stages be hidden from user boards, and means a template functions without a board connection.
- **Status/state gates human-gesture entry points.** A freshly opened issue has no label yet, and "entered the Todo column" is a human gesture — so `analyze.json` keeps `status=Todo`. Status triggers are not deprecated; they're the right tool when no label exists yet.
- **Swap-on-completion = consumed, and the swap is mechanized by the writeback turn.** A terminal agent's `issueWriteback.allowedLabels` lists only the label to *add* (QA → `conduit-review`); the label that *gated* the run (the trigger's `label` filter) is removed automatically. So a handoff is a remove-old/add-new swap the template never spells out — see the [issue writeback](./agent-execution.md#issue-writeback) section. A ticket sitting still can't re-trigger (its gating label is gone), and a human re-runs any stage by re-applying its label.
- **The label moves with the artifact.** Issue-stage labels (`conduit-dev`, `conduit-review`) live on the issue and ride the writeback swap. The merge gate (`conduit-merge`) lives on the PR/MR — a cross-artifact move the issue-scoped writeback can't make, so Review's Publish applies it in prose.
- **Status stays as a courtesy display, driven by the writeback allowlist — not hand-coded conditionals.** Terminal agents declare the courtesy column(s) in their per-agent `issueWriteback.allowedStatuses` ([issue-writeback.ts](../../packages/shared/src/agent/issue-writeback.ts)); the runtime fires an end-of-run turn that sets the status. Those values are picked from the board's Project v2 Status options at config time, so a *configured status implies a connected board* — there's no "if a board is connected" branch in any prompt. No board → no statuses picked → the writeback turn skips the status move.

The auto-chain: `analyze`'s Publish branches on the analysis. A clear analysis applies `conduit-dev` + status `In Progress`, so an opened issue flows to a draft PR untouched. If open questions remain for the user, it instead sets a **human-facing `Review` status and `Review` label** (no `conduit-*` label) and parks the issue — `Review` here is a user signal, distinct from `conduit-review`, and triggers no workflow. GitHub Projects users who prefer drag-to-column can swap `develop`'s trigger filter to `status=Dev` (a documented per-template knob — "rename the trigger filter to match your board's column or label names"). GitLab boards are label-native, so the label default works out of the box. The trigger engine treats `label` and `status` as equal filter primitives (`packages/shared/src/trigger/`) — this is template configuration, not an engine feature.

**Cross-platform human signals.** A `conduit-*` machine label is already a label, so it shows on GitLab's label boards and gates uniformly. But a *human-facing* stage that has no `conduit-*` label (Analyze's "needs user review" park) is set as **both a status and a same-named label** — the status renders on a GitHub Projects board, the label renders on a GitLab label board — so the signal is visible whichever board system the platform uses.

The `conduit-*` labels are created by agents or users as needed; templates don't auto-create them.

## Placeholder format

Template definitions reference connection ids using `<alias>` strings. Recognized by the regex `^<([a-z][a-z0-9-]*)>$/i` in `packages/shared/src/template/placeholder.ts`.

```json
{
  "triggers": [{
    "connectionId": "<github-repo>",
    "boardConnectionId": "<github-board>"
  }],
  "mcpServers": [{ "connectionId": "<github-repo>" }]
}
```

Every slot that accepts a connection id is walked by `collectTemplatePlaceholderDetails` / `resolveTemplate`:

| Slot | Expected scope kind |
|---|---|
| `definition.triggers[].connectionId` | `github_repo` |
| `definition.triggers[].boardConnectionId` | `github_projects_v2` |
| `definition.mcpServers[].connectionId` | `any` (platform-only filtering in v1) |

Convention for shipped templates: `<github-repo>` for repo bindings, `<github-board>` for board bindings — but the **type check happens against the slot the placeholder sits in, not the alias name**. A template author can pick any alias; the API rejects bindings whose Connection scope doesn't match the slot.

Placeholders are **bundle-scoped**: the same `<github-repo>` alias in workflow A and workflow B resolves to the same `Connection` id at creation time — the user supplies one binding and the Connection is reused across both workflows.

## The instantiation endpoint

`POST /api/workflows/from-template/:templateId` accepts:

```ts
{ bindings: Record<alias, TemplateBinding> }

type TemplateBinding =
  | { mode: 'existing'; connectionId: string }
  | {
      mode: 'new';
      name: string;
      credentialId: string;
      scope: ConnectionScope;   // discriminated union — see design-docs/connections.md
    };
```

Behavior:

1. Missing bindings → `400` with `{ message, missing: string[] }`.
2. Unknown `credentialId` / `connectionId` → `400`.
3. Scope-kind mismatch (a binding whose Connection scope doesn't match the slot's expected kind) → `400`.
4. Wraps everything in a Prisma `$transaction`:
   - Materialize each unique `new` binding into a `Connection` row once (shared across the bundle).
   - For each template workflow: substitute placeholder ids into the cloned definition, run `assertValidWorkflowDefinition` (any failure rolls back the bundle), create the `Workflow` row.
5. After commit, iterates the created workflows and calls `TemporalService.upsertPollSchedule` for any trigger whose `type !== 'webhook'` (i.e. the polling variants). Schedule failures are logged (not rolled back) — an inconsistent schedule recovers on next save or API boot via `WorkflowsService.onModuleInit`.

Response: `{ templateId, workflows: [{ id, name }, ...] }`.

### Connections are global

A bundle of N workflows that all reference `<github-repo>` produces **one** `Connection` row, shared across every workflow in the bundle. The `Connection` table is global (no per-workflow ownership), and rotation flows through the underlying `Credential` row. See [connections.md](./connections.md).

### Created workflows are paused

`Workflow.isActive` is `false` on creation. Polling schedules are created paused (`upsertPollSchedule` passes `paused: !isActive`). Webhook deliveries skip inactive workflows. The user reviews the generated definition on the canvas, then flips the workflow active.

## Templates shipped with v1

| File | Workflows | Pipeline |
|---|---|---|
| `templates/analyze.json` | 1 | Polling on `status = "Todo"` → `Research` (GitHub MCP) → `Review` → `Publish` (GitHub MCP) updates the issue body with a marker-bracketed analysis section, then branches: clear analysis → `conduit-dev` + status `In Progress` (auto-chains into `develop.json`); open questions remain → human-facing `Review` status + `Review` label, no `conduit-*` label (parks for the user). Status-gated entry (human gesture) → label-gated handoff. Uses `research` / `plan-reviewer` / `publish` presets. |
| `templates/pr-review.json` | 1 | GitHub `pull_requests` trigger → single `Review` agent (lands directly on `pr.headRef`) reviews the diff via GitHub MCP, posts a COMMENT review, then sets the PR's **draft/ready** state from its verdict via end-of-run [writeback](./agent-execution.md#issue-writeback) (clean → ready for review, blocking issues → draft; GitHub-only — inert on GitLab). Uses `pr-reviewer` preset. |
| `templates/develop.json` | 1 | Polling on `label = "conduit-dev"` (applied by Analyze, or by a human) → `Planner` (`planner` preset) fans out to `Dev` (`developer` preset) + `Tests` (`tests` preset) → `Docs` (`docs` preset) on branched worktrees → merge-back → `QA` (`qa` preset) opens a draft PR and swaps the issue label `conduit-dev`→`conduit-review` (status move to `"Review"` is courtesy). GitHub board users can swap the trigger to `status=Dev`. |
| `templates/review.json` | 1 | Polling on `label = "conduit-review"` → `Review` (`code-reviewer` preset) evaluates the branch and writes verdict to `.conduit/` → `Publish` (`publish` preset, GitHub MCP) submits the PR review, then on approval removes `conduit-review` and applies `conduit-merge` to the PR, or on changes requested removes `conduit-review` and moves status to a human column (no relabel — a human re-applies `conduit-dev`). Pairs with `develop.json` and `merge.json` as a label-gated pipeline. |
| `templates/merge.json` | 1 | Polling on `label = "conduit-merge"` AND `pr_state = "ready_for_review"` → `Merger` (`merger` preset, GitHub MCP) verifies CI and merges, resolving mechanical conflicts and escalating semantic ones back to draft. The final stage of the label-gated pipeline. |
| `templates/nightly-review.json` | 1 | `cron` trigger (`0 2 * * *` UTC, `branch: main`; depends on the `cron` trigger type) → `Scope` (`scope` preset) identifies changed files and writes a per-domain manifest → fans out to four parallel reviewers `Security` / `Quality` / `Refactor` / `Performance` (all `code-analyst` preset, one domain each) → `Publisher` (`issue-publisher` preset, GitHub MCP) opens one issue per finding, routed by confidence to a `Review` or `AIDev` board status via `issueWriteback.allowedStatuses`. Six agents; not a label-gated stage — a standalone scheduled fan-out. |

Instructions in the shipped templates **do not** tell agents to "write `.conduit/<Node>.md`" — the runtime already drives a second turn with `finalSummaryPrompt(node.name)` and drops a placeholder if the agent didn't write one. See [agent-execution.md](./agent-execution.md#runagentnode-lifecycle).

## Why static files, not DB

- **No schema changes** — templates don't need a DB table for v1.
- **Version-controlled** — templates live with the code, evolve via PRs.
- **Simple invalidation** — editing a template file doesn't affect existing workflows (they were copied at creation time).
- **Easy to add new ones** — just drop a JSON file in `/templates/`.

If user-created templates become a feature later, upgrade path is: add a `WorkflowTemplate` DB table, seed it from the JSON files on boot, accept user contributions via API. The UI and `from-template` flow don't change.
