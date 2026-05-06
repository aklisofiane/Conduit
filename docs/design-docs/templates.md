# Workflow Templates

Pre-built workflow blueprints shipped with Conduit to help users get started quickly. Templates are starting points, not runtime entities.

## How it works

1. Templates live as JSON files in `/templates/` at the repo root. They reference reusable agent prompts from `/agent-presets/*.json` — see [agent-presets.md](./agent-presets.md).
2. `TemplatesService.onModuleInit` reads the directory **once at API boot** via the shared `loadJsonDir` helper (`apps/api/src/common/load-json-dir.ts`), validates each file against the input Zod schema in `@conduit/shared/template`, expands `presetId` references via `expandTemplate`, re-validates against the runtime schema, then caches the entries. Files that fail any step (parse, input schema, unknown preset, post-expansion schema) are logged and skipped. **Editing a template on disk requires an API restart** to take effect.
3. `GET /api/templates` returns the cached list — `{ id, name, description, category, workflowCount, placeholders }`. `placeholders` is the deduplicated list of `<alias>` strings the bundle references, used by the UI to build the binding form.
4. The user picks a template in the UI (`TemplatePickerDialog` on the workflow list) and supplies one `TemplateBinding` per placeholder.
5. `POST /api/workflows/from-template/:templateId` resolves the placeholders, runs `validateWorkflowDefinition` per resolved workflow, creates all workflow rows + per-workflow connections in a single Prisma `$transaction`, then upserts Temporal poll schedules after the transaction commits.

Templates are **static seed data**, not first-class DB entities. They never link back to the workflows created from them. Editing a template file doesn't affect existing workflows.

A template can contain **one or more workflow definitions**. Single-workflow templates (`analyze`, `develop`, `pr-review`) have a one-element `workflows` array; the multi-workflow bundle (`board-loop`'s Developer + Reviewer pair) ships multiple definitions that share a connection placeholder and are created together.

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

**Category** is one of `triage | develop | review | board-loop` — a display-only hint for grouping in the picker.

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

## Placeholder format

Template definitions reference `connectionId` values using `<alias>` strings. Recognized by the regex `^<([a-z][a-z0-9-]*)>$/i` in `packages/shared/src/template/placeholder.ts`.

```json
{
  "triggers": [{ "connectionId": "<github>", ... }],
  "mcpServers": [{ "connectionId": "<github>", ... }]
}
```

Every slot that accepts a connection id is walked by `collectTemplatePlaceholders` / `resolveTemplate`:

- `definition.triggers[].connectionId`
- `definition.mcpServers[].connectionId`

Placeholders are **bundle-scoped**: the same `<github>` alias in workflow A and workflow B resolves to the same per-workflow binding at creation time — the user supplies one binding for `<github>` and it's applied to both workflows.

## The instantiation endpoint

`POST /api/workflows/from-template/:templateId` accepts:

```ts
{ bindings: Record<alias, TemplateBinding> }

type TemplateBinding =
  | { mode: 'existing'; connectionId: string }
  | {
      mode: 'new';
      alias: string;
      credentialId: string;
      owner?: string;
      repo?: string;
      webhookSecret?: string;
    };
```

Behavior:

1. Missing bindings → `400` with `{ message, missing: string[] }`.
2. Unknown `credentialId` / `connectionId` → `400`.
3. Wraps everything in a Prisma `$transaction`:
   - For each template workflow: create the `Workflow` row (with an empty placeholder definition), then for each unique `<alias>` placeholder create a `WorkflowConnection` row (`mode: 'new'`) or read the id (`mode: 'existing'`), then substitute placeholders and update the row with the resolved definition.
   - `assertValidWorkflowDefinition` runs on the resolved definition inside the transaction — any failure (e.g. a webhook trigger that doesn't carry an issue/PR ref) rolls back the whole bundle.
4. After commit, iterates the created workflows and calls `TemporalService.upsertPollSchedule` for any polling-mode trigger. Schedule failures are logged (not rolled back) — an inconsistent schedule recovers on next save or API boot via `WorkflowsService.onModuleInit`.

Response: `{ templateId, workflows: [{ id, name }, ...] }`.

### Connections are per-workflow

`WorkflowConnection` rows are keyed on `(workflowId, alias)` in the Prisma schema, so a bundle of N workflows that all reference `<github>` produces N connection rows — all pointing at the same credential. This is deliberate: each workflow owns its connection so edits (e.g. adding a webhook secret on the Worker but not the Critic) stay local.

### Created workflows are paused

`Workflow.isActive` is `false` on creation. Polling schedules are created paused (`upsertPollSchedule` passes `paused: !isActive`). Webhook deliveries skip inactive workflows. The user reviews the generated definition on the canvas, then flips the workflow active.

## Templates shipped with v1

| File | Workflows | Pipeline |
|---|---|---|
| `templates/analyze.json` | 1 | GitHub `issues.opened` webhook → `Research` (GitHub MCP) → `Review` → `Publish` (GitHub MCP) updates the issue body with a marker-bracketed analysis section. Uses `research` / `reviewer` / `publish` presets. |
| `templates/pr-review.json` | 1 | GitHub `pull_request.opened` webhook → single `Review` agent (lands directly on `pr.headRef`) + GitHub MCP reviews the diff. Uses `reviewer` preset. |
| `templates/develop.json` | 1 | Polling on `status = "Dev"` → `Seed` (`research` preset) fans out to `Dev` (`developer` preset) + `Tests` (`tests` preset) + `Docs` (`docs` preset) on branched worktrees → merge-back → `QA` (`qa` preset) opens a draft PR and moves the ticket to `"Review"`. |
| `templates/board-loop.json` | 2 | **Developer** (polling on `status = "Dev"`, pushes to `conduit/<ticket>`, opens a draft PR on first push, moves to `"AIReview"` — `developer` preset) + **Reviewer** (polling on `status = "AIReview"`, same branch, approves or moves back to `"Dev"` — `reviewer` preset; the `instructionsAppend` re-grants `APPROVE`-state PR reviews, which the base preset disallows). Shares a single `<github>` placeholder across both workflows. |

Instructions in the shipped templates **do not** tell agents to "write `.conduit/<Node>.md`" — the runtime already drives a second turn with `finalSummaryPrompt(node.name)` and drops a placeholder if the agent didn't write one. See [agent-execution.md](./agent-execution.md#runagentnode-lifecycle).

## Why static files, not DB

- **No schema changes** — templates don't need a DB table for v1.
- **Version-controlled** — templates live with the code, evolve via PRs.
- **Simple invalidation** — editing a template file doesn't affect existing workflows (they were copied at creation time).
- **Easy to add new ones** — just drop a JSON file in `/templates/`.

If user-created templates become a feature later, upgrade path is: add a `WorkflowTemplate` DB table, seed it from the JSON files on boot, accept user contributions via API. The UI and `from-template` flow don't change.
