# Agent Presets

Reusable agent prompts shipped as markdown in `/agent-presets/`. A preset is a single source of truth for one agent's `provider`, `model`, and `instructions`. The canvas's agent config panel uses presets to prefill those three fields, and workflow templates reference presets so a tweak to a preset propagates to every template that uses it.

Presets are **catalog data**, not runtime entities. They never link back to created agents. Editing a preset on disk affects:

- New agents created via the canvas's preset picker (next time the user picks it).
- New workflows created from a template that references the preset (after the API restarts).

Existing agents and existing workflows are unaffected — their `instructions`, `model`, and `provider` were copied at creation time.

## File shape

Each preset is a markdown file with YAML frontmatter. Metadata lives in the frontmatter; the prose `instructions` field is the markdown body.

```markdown
---
id: developer
name: Developer
description: Implements code changes from an upstream plan...
category: implement
provider: claude
model: claude-opus-4-6
---

You are a Developer agent. Read the trigger context and any upstream
agent's plan in `.conduit/` (typically a Research or planning summary)...
```

Schema: `agentPresetFileSchema` in `packages/shared/src/agent-preset/schema.ts`.

- `id` — kebab-case, used by templates to reference the preset (and by `GET /agent-presets/:id`).
- `category` — one of `research | review | implement | qa | publish`. Drives the `<optgroup>` grouping in the canvas picker.
- `provider` / `model` — set in frontmatter; prefilled into the agent alongside `instructions` (the body).
- `instructions` — the markdown body. Loader strips frontmatter and trims surrounding whitespace before validation.
- `suggestedConstraints` — optional frontmatter field (`maxTurns`, `timeoutSec`). Not currently consumed by the canvas picker; reserved for future use.

Workflow-scoped fields (`mcpServers`, `skills`) are intentionally **absent**. The user wires those up per-workflow after applying a preset, because they depend on the workflow's connections. Workspaces aren't on this list either — they're derived from edges at load time, not user-authored.

## Load lifecycle

1. `AgentPresetsService.onModuleInit` runs at API boot.
2. `loadAgentPresets` reads `/agent-presets/*.md` (override with `CONDUIT_AGENT_PRESETS_DIR`). Each file is parsed with `gray-matter`: frontmatter becomes the metadata object, the body becomes `instructions`.
3. Each file is validated against `agentPresetFileSchema`. Invalid files are logged and skipped.
4. Valid presets are cached in a `Map<id, AgentPreset>` for the lifetime of the process. **Editing a preset on disk requires an API restart.**

Markdown was chosen over JSON because the `instructions` field is multi-paragraph prose with bullets and code fences — content JSON can only encode as a single-line escaped string. Templates remain JSON (`/templates/*.json`) because they encode deeply nested workflow definitions, not prose.

## API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/agent-presets` | List all loaded presets. |
| `GET` | `/agent-presets/:id` | Fetch one preset by id. 404 if not loaded. |

Both routes go through `SessionGuard` (Better Auth session cookie). The web client wraps them with `useAgentPresets` (`apps/web/src/api/hooks.ts`).

## Canvas picker behavior

`apps/web/src/components/canvas/AgentConfigPanel.tsx` renders a **Preset** dropdown above the provider/model row when the API returns at least one preset.

The dropdown has no separate "selected preset" state on the agent — it derives the current value by **content matching**: a preset is "selected" when its `instructions`, `model`, and `provider` all match the agent's current values. As soon as the user edits any of those three fields, the picker drops back to "Custom — write your own" (the empty-value option).

Picking a preset patches the three fields via `onChange`. If the agent already has non-trivial instructions that differ from the preset's, the picker confirms before overwriting.

This design avoids storing a `presetId` on the agent. Presets are a **prefill mechanism**, not a binding — once applied, the agent owns its instructions and a later edit to the preset on disk doesn't touch live workflows.

## Template usage

Templates reference presets via `presetId` instead of inlining literal prompts. The on-disk template agent shape (`templateAgentInputSchema`) accepts either:

- `{ presetId: "developer", instructionsAppend?: "extra workflow guidance" }`, or
- the three concrete fields inlined (`provider`, `model`, `instructions`).

`expandTemplate` in `packages/shared/src/template/expand.ts` rewrites `presetId`-using agents into the runtime `agentConfigSchema` shape during template load:

- `instructions` ← `preset.instructions` (+ `\n\n` + `instructionsAppend` if set).
- `model` ← `preset.model`.
- `provider` ← `preset.provider`.

`TemplatesService.onModuleInit` runs expansion before caching the template. Templates that reference an unknown preset are logged and **skipped** — they don't appear in `GET /templates`. See [templates.md](./templates.md) for the full template lifecycle.

`instructionsAppend` requires `presetId` (Zod `superRefine` rejects the combo with literal instructions). Workflow-specific guidance — e.g. review's three-outcome routing + loop guard on its Publish node, develop's Planner→fan-out handoff — lives in `instructionsAppend` so the base preset stays generic.

## Presets shipped with v1

| File | Category | Provider / model | Used by |
|---|---|---|---|
| `research.md` | research | claude / claude-opus-4-6 | `analyze` (Research) |
| `planner.md` | research | claude / claude-opus-4-6 | `develop` (Planner) |
| `scope.md` | research | claude / claude-sonnet-4-6 | `nightly-review` (Scope) |
| `plan-reviewer.md` | review | codex / gpt-5.5 | `analyze` (Review) |
| `code-reviewer.md` | review | codex / gpt-5.5 | `review` (Review) |
| `code-analyst.md` | review | codex / gpt-5.5 | `nightly-review` (Security, Quality, Refactor, Performance) |
| `developer.md` | implement | claude / claude-opus-4-6 | `develop` (Dev) |
| `tests.md` | implement | claude / claude-opus-4-6 | `develop` (Tests) |
| `docs.md` | implement | claude / claude-opus-4-6 | `develop` (Docs) |
| `qa.md` | qa | codex / gpt-5.5 | `develop` (QA) |
| `merger.md` | publish | claude / claude-opus-4-6 | `merge` (Merger) |
| `issue-publisher.md` | publish | claude / claude-sonnet-4-6 | `nightly-review` (Publisher) |
| `publish.md` | publish | claude / claude-sonnet-4-6 | `analyze` (Publish), `review` (Publish) |

The `publish` preset (shared by `analyze`/`review`, and inherited by `issue-publisher`) owns the `<!-- conduit:start --> … <!-- conduit:end -->` body block contract. When it operates on a non-default base branch it stamps a `<!-- conduit:base=<branch> -->` marker inside the block, so downstream ticket-branch work bases off the same branch — see [branch-management.md > Base ref selection](./branch-management.md#base-ref-selection).

The review presets are platform-agnostic — they describe what the agent reads, evaluates, and produces without referencing specific platforms. Platform-specific actions (review submission states, ticket column names, issue-body markers) live in template `instructionsAppend`. In `review`, the `code-reviewer` agent classifies the diff (`APPROVE` / `REQUEST_CHANGES_AGENT` / `REQUEST_CHANGES_HUMAN`) into `.conduit/`, and the downstream `publish` agent submits APPROVE or REQUEST_CHANGES and performs the label/state routing — keeping every platform write in one node.

Two prompt directives are load-bearing across the catalog and worth calling out:

- **Pattern comparison.** When a request introduces a new instance of a kind that already exists in the repo (a new provider, a new node type, a new transport, …), the Research preset requires the agent to compare the proposal against each existing implementation along the same dimensions and quote the relevant files. The review presets (`plan-reviewer`, `code-reviewer`) enforce this from the other side — if upstream skipped the comparison and an obvious one was available, raise it as a gap.
- **Unverified-claim flagging.** Research and the review presets treat factual claims about external dependencies as unverified by default. Research lists them under "Unverified claims" rather than relaying as fact (using web search to verify when the agent has it enabled); the review presets treat unverified third-party claims as gaps unless they can be confirmed from the workspace.

Both directives live in the preset prompt, not in node config, so workflow authors don't have to re-state them per agent. Tightening them was a response to repeated runs that accepted issue framings as fact and missed in-repo divergences even when the existing patterns sat in the same workspace.

## Why static files, not DB

Same reasoning as templates — version-controlled, no schema, easy to add new ones, simple invalidation (existing agents/workflows aren't affected). If user-created presets become a feature later, the upgrade path is to add a `AgentPreset` table seeded from the JSON files on boot; the canvas picker and template loader contracts don't change.
