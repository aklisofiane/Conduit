# Frontend

React 19 + Vite 8 + `@xyflow/react` + TanStack Query + Zustand + Tailwind v4 + shadcn/ui (New York / Zinc).

## Screens

| Screen | Purpose |
|---|---|
| `/` | Dashboard: stat cards (Workflows, Total runs, Active, Running now, Failing) + workflow list (name, last run, status, active toggle) + "new workflow" + "from template" entry points |
| `/workflows/:id` | Edit — canvas + config side panel (design only, no runtime data) |
| `/workflows/:id/connections` | Manage the workflow's `WorkflowConnection`s — alias → credential + owner/repo + optional webhook signing secret |
| `/workflows/:id/runs` | Run history list (status, trigger, duration, started at) |
| `/runs/:runId` | Run detail — dedicated observation page with live logs (not on the canvas) |
| `/credentials` | Manage `PlatformCredential`s (global — reused across workflows via connections) |
| `/settings` | User / org settings (minimal v1) |

## Create from template

The workflow list's header row has a **"From template"** button next to **"New workflow"**. Clicking it opens `TemplatePickerDialog` (`apps/web/src/components/templates/TemplatePickerDialog.tsx`), a two-step modal:

1. **Pick** — grid of template cards (name, category, workflow count, description) sourced from `useTemplates()` → `GET /api/templates`.
2. **Bind** — one row per unique `<alias>` placeholder in the picked template. Each row toggles between **New** (alias + credential picker + optional owner/repo) and **Existing** (paste an existing `WorkflowConnection` id). Submit calls `useCreateFromTemplate()` → `POST /api/workflows/from-template/:id` and navigates to the first created workflow.

Created workflows are paused — the user reviews the generated canvas before activating. See [design-docs/templates.md](./design-docs/templates.md) for the full flow.

## Canvas

React Flow with a small palette. Two node types.

### Palette

Left rail (`apps/web/src/components/canvas/NodePalette.tsx`). Every card is both click-to-add and HTML5-draggable onto the canvas; the drag payload is a JSON-encoded `PaletteDragPayload` carried via the `application/conduit-node` MIME type so stray OS drags are ignored.

- **Agent cards** (`Claude`, `Codex`) — click adds a new agent at canvas center; drag drops at the pointer. The drop handler in `CanvasPage` converts screen → flow coordinates via `rf.screenToFlowPosition` before inserting the node.
- **Trigger card** — singleton. Click re-centers the existing trigger (`rf.setCenter`) and opens its config panel; drag repositions the same trigger to the cursor. Dragging the trigger card never creates a second trigger.

Node positions are persisted to `Workflow.definition.ui.nodePositions` on drag-end only — see the `State` section below for the split between React Flow's measured layout and the persisted draft.

### Edges

Edges are drawn by a custom `WorkflowEdge` (`apps/web/src/components/canvas/WorkflowEdge.tsx`). Selection toggles a thicker accent stroke and renders a small × button at the edge midpoint via `EdgeLabelRenderer`. Backspace with an edge selected and the × button both fan into React Flow's `onEdgesChange` `remove` event — there's a single delete code path, and `flowEdgesToDomain` rebuilds the persisted `WorkflowDefinition.edges` from whatever React Flow state survives. Trigger→agent edges are user-drawn like any other; the canvas does not auto-link a freshly added agent to the trigger, so an unwired agent is visible as an orphan and is silently skipped at runtime.

### Node components

- **`TriggerNode`** — pill-shaped, platform icon, event label, filter count. Output handle only.
- **`AgentNode`** — large card. Visual style varies by provider for quick at-a-glance identification via distinct accent colors and a letter glyph (e.g., "C" for Claude in warm amber, "X" for Codex in cool teal) paired with the plain-text provider name.
  - Header: name, provider label ("Claude" / "Codex"), model
  - Body: instructions preview (first 2 lines), MCP server chips (up to 4 + "+N more"), skill chips. (Workspace kind is derived from graph topology — not surfaced on the canvas.)
  - Input + output handles
  - **No runtime state on the canvas** — no status dots, no streaming text. Runtime observation lives on the dedicated run page.

Visual tokens (palette, per-provider color/font/label, radii, the `providerStyle()` helper) live in [DESIGN.md](./DESIGN.md).

### Config side panel

Opens on node click. Form driven by Zod schema from `@conduit/shared`.

- **Trigger panel**: platform picker → connection picker → mode toggle (webhook / polling) → event or interval input → `BoardRef` fieldset (org/user · owner · project picker) → filter builder. Each filter row is a `Status | Label` left-side dropdown plus a right-side single-select sourced from live GitHub data — Status options come from the selected board's Status column (preloaded with the board), Label options come from the connection's bound repo via `useListLabels`. Both sides share one `OptionsValueInput` component: a `<select>` of available options, a free-text fallback when the list hasn't loaded, and a stale-cache `(not found)` synthetic entry so a renamed value still surfaces what's stored. The board list is fetched via `useListProjectBoards` (TanStack Query, keyed on `(connectionId, ownerType, owner)`, 30s `staleTime`); typing the owner is debounced 400ms before keying the query so quick keystrokes don't fan out. Mode-driven board picker visibility is unchanged — it shows for polling and for the webhook event `board.column.changed`. `<FilterEditor>`, `<FilterRow>`, `<OptionsValueInput>`, and `<BoardPicker>` all live next to `TriggerConfigPanel` in `apps/web/src/components/canvas/TriggerConfigPanel.tsx`.
- **Agent panel**: name field (identifier validation), preset picker (see below), provider + model dropdown, instructions textarea (monospace, generous height), **Web search** checkbox (off by default — toggles the provider's built-in web search/fetch; see [agent-execution.md](./design-docs/agent-execution.md#web-search)), **Issue writeback** control (opt-in checkbox + pill-toggle groups for allowed statuses + labels — see below), MCP server picker (presets with one-click add + custom server config), skill picker (see below), constraints (collapsible). No workspace picker — workspace is derived from graph position (see [node-system.md](./design-docs/node-system.md#workspace-inheritance)).

### Agent preset picker

Above the provider/model row, a single `<select>` lets the user prefill `instructions`, `model`, and `provider` from a shipped preset (`GET /api/agent-presets`, fetched via `useAgentPresets`). Options are grouped by `category`. There's no separate "selected preset" state on the agent — the picker derives its current value by content match (instructions + model + provider all equal a preset's), and falls back to "Custom — write your own" the moment any of those three fields diverges. Picking a preset confirms before overwriting non-trivial existing instructions. See [design-docs/agent-presets.md](./design-docs/agent-presets.md).

### Skill picker

The agent config panel includes a skills section:
- Displays skills discovered from the repo (`.claude/skills/`, `.agents/skills/`) and the worker host.
- Each skill shown as a card with name and description (from `SKILL.md` frontmatter).
- Click to attach/detach. Attached skills are copied into the workspace at runtime.
- Skills are filtered by provider — Claude skills shown when provider is Claude, Codex skills when Codex. Skills present in both formats shown for either.

### Issue writeback control

Above the MCP server picker, an opt-in control that lets an agent end its run by updating the triggering GitHub issue:

- **Checkbox** — turns the feature on; presence of the field on `AgentConfig` (vs. `undefined`) is the on/off signal.
- **Allowed statuses** pills — the trigger board's `Status` single-select options, fetched via `useListProjectBoards`.
- **Allowed labels** pills — the trigger repo's labels, fetched via `useListLabels` (`POST /api/workflows/:id/trigger/list-labels`).

If the workflow has no GitHub trigger, the control collapses to a hint. With the checkbox on but nothing picked, a muted note warns that the runtime will skip the writeback turn. The runtime side is documented in [agent-execution.md > Issue writeback](./design-docs/agent-execution.md#issue-writeback).

Internal helpers `PillSection` (loading/empty wrapper) and `PillToggleGroup` (the toggle row itself) live in the same file and aren't reused elsewhere — kept local until a second consumer appears.

### MCP server picker

The agent config panel includes an MCP server section:
- **Presets** shown as clickable cards (GitHub, Slack, Filesystem, etc.) — one click to add with sensible defaults.
- **Custom** button opens a form for transport config (stdio command / SSE URL).
- Each added server shows its tool list (discovered via `POST /api/mcp/introspect` at config time, cached in `WorkflowMcpServer.discoveredTools`) with per-tool allow/deny checkboxes. A "Refresh tools" button re-introspects.
- Credential binding: dropdown to link a `WorkflowConnection` for auth.

### State

- **Server state** — TanStack Query. `useWorkflow(id)`, `useRun(id)`, `useRunUpdates(id)` (WS subscription, only on the run page).
- **Canvas state** — Zustand. Tracks selection, dirty flags, pending edits not yet persisted. Persistent canvas state (node positions, viewport) lives in `Workflow.definition.ui`.
- **Forms** — react-hook-form + Zod resolver, schemas imported directly from `@conduit/shared`.

## Run history (`/workflows/:id/runs`)

List of runs for a workflow. Each row shows:
- Status badge (pending / running / completed / failed / cancelled)
- Trigger source + event (e.g., "GitHub · issues.opened")
- Duration (or "running" timer for in-flight runs)
- Started at, finished at
- Actor / issue reference if available

Clickable → opens the run detail page.

## Run detail (`/runs/:runId`)

Dedicated observation page, independent of the canvas. Layout:

- **Top bar**: run metadata (workflow name link, trigger summary, started at, duration, status badge, Cancel button for in-flight runs). The top bar itself is the global `TopChrome` shell — pages publish a `center` and `actions` ReactNode into it via `useTopbarSlots()` (`apps/web/src/state/topbar-slots.ts`). The store identity-checks before setting and uses split per-slot effects so an unchanged slot doesn't churn when the other one changes; memoize the published nodes on the producer side or you defeat both.
- **Left rail**: list of nodes in execution order, each with a status dot, name, and elapsed time. The selected node highlights.
- **Main area** (tabs for the selected node):
  - **Timeline** — live stream of `ExecutionLog` entries (text chunks, tool calls with expandable input/output, token usage). Auto-scrolls while running.
  - **Summary** — `.conduit/<NodeName>.md` as raw monospace text. Sourced from `NodeRun.conduitSummary` (snapshotted before workspace cleanup, so it survives after the run ends). Markdown rendering may come later.
  - **Changed files** — list with click-to-diff.
  - **Error** — stack + context if the node failed. The page auto-switches to this tab when the selected node is `FAILED`, so the user doesn't hunt for it.

No canvas, no graph rendering here. Just logs and inspection.

## Real-time updates

`useRunUpdates(runId)` hook, used **only on the run detail page** (not the canvas):
1. Connects to Socket.IO `runs/<runId>` room on mount.
2. Receives `{ nodeName, event: AgentEvent }` messages.
3. Merges into TanStack Query cache for `['run', runId]` and `['run', runId, 'log', nodeName]`.
4. Disconnects on unmount.

## Design conventions

- Tailwind v4, custom warm-paper light palette (no Zinc / no shadcn theme — see [DESIGN.md](./DESIGN.md) for the token layer).
- oklch for status and accent colors; per-provider warm/cool families distinguish Claude (amber) from Codex (teal-green).
- Light surfaces by default. Dense but not cramped.
- Monospace for identifiers, instructions, JSON. Provider-display font is part of the provider token (Claude → sans, Codex → mono).
- Motion: subtle — node status transitions use 150ms fades, no bouncy springs.
