# Agent Presets

Reusable agent prompts shipped as JSON in `/agent-presets/`. A preset is a single source of truth for one agent's `provider`, `model`, and `instructions`. The canvas's agent config panel uses presets to prefill those three fields, and workflow templates reference presets so a tweak to a preset propagates to every template that uses it.

Presets are **catalog data**, not runtime entities. They never link back to created agents. Editing a preset on disk affects:

- New agents created via the canvas's preset picker (next time the user picks it).
- New workflows created from a template that references the preset (after the API restarts).

Existing agents and existing workflows are unaffected — their `instructions`, `model`, and `provider` were copied at creation time.

## File shape

```json
{
  "id": "developer",
  "name": "Developer",
  "description": "Implements code changes from an upstream plan...",
  "category": "implement",
  "provider": "claude",
  "model": "claude-opus-4-6",
  "instructions": "You are a Developer agent...",
  "suggestedConstraints": { "maxTurns": 40, "timeoutSec": 1800 }
}
```

Schema: `agentPresetFileSchema` in `packages/shared/src/agent-preset/schema.ts`.

- `id` — kebab-case, used by templates to reference the preset (and by `GET /agent-presets/:id`).
- `category` — one of `research | review | implement | qa | publish`. Drives the `<optgroup>` grouping in the canvas picker.
- `provider` / `model` / `instructions` — the three fields prefilled into the agent.
- `suggestedConstraints` — optional. Not currently consumed by the canvas picker; reserved for future use.

Workflow-scoped fields (`workspace`, `mcpServers`, `skills`) are intentionally **absent**. The user wires those up per-workflow after applying a preset, because they depend on the workflow's connections and topology.

## Load lifecycle

1. `AgentPresetsService.onModuleInit` runs at API boot.
2. `loadAgentPresets` reads `/agent-presets/*.json` (override with `CONDUIT_AGENT_PRESETS_DIR`) via the shared `loadJsonDir` helper in `apps/api/src/common/load-json-dir.ts` — same pattern as `TemplatesService`.
3. Each file is validated against `agentPresetFileSchema`. Invalid files are logged and skipped.
4. Valid presets are cached in a `Map<id, AgentPreset>` for the lifetime of the process. **Editing a preset on disk requires an API restart.**

## API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/agent-presets` | List all loaded presets. |
| `GET` | `/agent-presets/:id` | Fetch one preset by id. 404 if not loaded. |

Both routes go through `ApiKeyGuard`. The web client wraps them with `useAgentPresets` (`apps/web/src/api/hooks.ts`).

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

`instructionsAppend` requires `presetId` (Zod `superRefine` rejects the combo with literal instructions). Workflow-specific guidance — e.g. board-loop's iteration mechanics, develop's Seed→fan-out handoff, pr-review's PR-branch checkout — lives in `instructionsAppend` so the base preset stays generic.

## Presets shipped with v1

| File | Category | Used by |
|---|---|---|
| `research.json` | research | `analyze` (Research), `develop` (Seed) |
| `reviewer.json` | review | `analyze` (Review), `pr-review` (Review), `board-loop` (Reviewer) |
| `developer.json` | implement | `develop` (Dev), `board-loop` (Developer) |
| `tests.json` | implement | `develop` (Tests) |
| `docs.json` | implement | `develop` (Docs) |
| `qa.json` | qa | `develop` (QA) |
| `publish.json` | publish | `analyze` (Publish) |

All ship with `provider: claude`, `model: claude-opus-4-6`. The reviewer preset's prompt explicitly **does not** authorize `APPROVE`-state PR reviews — workflows that need that (e.g. `board-loop`'s Reviewer) re-grant the permission via `instructionsAppend`.

Two prompt directives are load-bearing across the catalog and worth calling out:

- **Pattern comparison.** When a request introduces a new instance of a kind that already exists in the repo (a new provider, a new node type, a new transport, …), the Research preset requires the agent to compare the proposal against each existing implementation along the same dimensions and quote the relevant files. The Reviewer preset enforces this from the other side — if upstream skipped the comparison and an obvious one was available, raise it as a research gap.
- **Unverified-claim flagging.** Both presets treat factual claims about external dependencies as unverified by default. Research lists them under "Unverified claims" rather than relaying as fact (using web search to verify when the agent has it enabled); Reviewer treats unverified third-party claims as gaps unless they can be confirmed from the workspace.

Both directives live in the preset prompt, not in node config, so workflow authors don't have to re-state them per agent. Tightening them was a response to repeated runs that accepted issue framings as fact and missed in-repo divergences even when the existing patterns sat in the same workspace.

## Why static files, not DB

Same reasoning as templates — version-controlled, no schema, easy to add new ones, simple invalidation (existing agents/workflows aren't affected). If user-created presets become a feature later, the upgrade path is to add a `AgentPreset` table seeded from the JSON files on boot; the canvas picker and template loader contracts don't change.
