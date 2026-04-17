# Frontend

React 19 + Vite 8 + `@xyflow/react` + TanStack Query + Zustand + Tailwind v4 + shadcn/ui (New York / Zinc).

## Screens

| Screen | Purpose |
|---|---|
| `/` | Workflow list (name, last run, status, active toggle) |
| `/workflows/new` | Create — opens empty canvas with a single trigger node |
| `/workflows/:id` | Edit — canvas + config side panel (design only, no runtime data) |
| `/workflows/:id/runs` | Run history list (status, trigger, duration, started at) |
| `/runs/:runId` | Run detail — dedicated observation page with live logs (not on the canvas) |
| `/credentials` | Manage `PlatformCredential`s |
| `/settings` | User / org settings (minimal v1) |

## Canvas

React Flow with a small palette. Two node types.

### Node components

- **`TriggerNode`** — pill-shaped, platform icon, event label, filter count. Output handle only.
- **`AgentNode`** — large card. Visual style varies by provider for quick at-a-glance identification via distinct accent colors and a letter glyph (e.g., "C" for Claude in warm amber, "X" for Codex in cool teal) paired with the plain-text provider name.
  - Header: name, provider label ("Claude" / "Codex"), model
  - Body: instructions preview (first 2 lines), MCP server chips (up to 4 + "+N more"), skill chips, workspace kind icon
  - Input + output handles
  - **No runtime state on the canvas** — no status dots, no streaming text. Runtime observation lives on the dedicated run page.

### Config side panel

Opens on node click. Form driven by Zod schema from `@conduit/shared`.

- **Trigger panel**: platform picker → event picker → filter builder → connection picker.
- **Agent panel**: name field (identifier validation), provider + model dropdown, instructions textarea (monospace, generous height), MCP server picker (presets with one-click add + custom server config), skill picker (see below), workspace picker (fresh tmpdir / repo-clone / inherit / ticket-branch), constraints (collapsible).

### Skill picker

The agent config panel includes a skills section:
- Displays skills discovered from the repo (`.claude/skills/`, `.agents/skills/`) and the worker host.
- Each skill shown as a card with name and description (from `SKILL.md` frontmatter).
- Click to attach/detach. Attached skills are copied into the workspace at runtime.
- Skills are filtered by provider — Claude skills shown when provider is Claude, Codex skills when Codex. Skills present in both formats shown for either.

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

- **Top bar**: run metadata (workflow name link, trigger summary, started at, duration, status badge, Cancel button for in-flight runs).
- **Left rail**: list of nodes in execution order, each with a status dot, name, and elapsed time. The selected node highlights.
- **Main area** (tabs for the selected node):
  - **Timeline** — live stream of `ExecutionLog` entries (text chunks, tool calls with expandable input/output, token usage). Auto-scrolls while running.
  - **Summary** — `.conduit/<NodeName>.md` rendered as markdown (the agent's summary for downstream agents).
  - **Changed files** — list with click-to-diff.
  - **Error** — stack + context if the node failed.

No canvas, no graph rendering here. Just logs and inspection.

## Real-time updates

`useRunUpdates(runId)` hook, used **only on the run detail page** (not the canvas):
1. Connects to Socket.IO `runs/<runId>` room on mount.
2. Receives `{ nodeName, event: AgentEvent }` messages.
3. Merges into TanStack Query cache for `['run', runId]` and `['run', runId, 'log', nodeName]`.
4. Disconnects on unmount.

## Design conventions

- Tailwind v4, Zinc base palette, New York shadcn variant.
- Dark mode first. Dense but not cramped.
- Monospace for identifiers, instructions, JSON.
- Motion: subtle — node status transitions use 150ms fades, no bouncy springs.
