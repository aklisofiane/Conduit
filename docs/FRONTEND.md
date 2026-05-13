# Frontend

React 19 + Vite 8 + `@xyflow/react` + TanStack Query + Zustand + Tailwind v4. Headless primitives come from Radix UI (`@radix-ui/react-dialog`, `react-dropdown-menu`, `react-select`) — wrapped thinly in `apps/web/src/components/common/` (`Dialog`, `DropdownMenu`, `Select`) and styled with custom CSS in `apps/web/src/styles/globals.css`. No shadcn/ui — we use Radix directly so we don't carry a generated component layer.

## Screens

| Screen | Purpose |
|---|---|
| `/` | Workflow list (name, last run, status, active toggle) + "new workflow" + "from template" entry points |
| `/workflows/:id` | Edit — canvas + config side panel (design only, no runtime data) |
| `/workflows/:id/runs` | Run history list (status, trigger, duration, started at) |
| `/runs/:runId` | Run detail — dedicated observation page with live logs (not on the canvas) |
| `/settings` | Settings shell — left sidebar (`apps/web/src/components/layout/SettingsLayout.tsx`) reading from a config array (`apps/web/src/components/settings/settings-nav.ts`) + content outlet. Index redirects to `/settings/integrations`. The top-bar gear icon (`TopChrome`) lands here. |
| `/settings/integrations` | `Credential` + `Connection` management stacked on one surface. Credentials feed connections (one credential can back many; rotation propagates), so they live together rather than as separate sidebar entries. Typed scope picker is unchanged (`github_repo` `{owner, repo}` / `github_projects_v2` `{ownerType, owner, number}` / `none`). Old `/credentials` and `/connections` paths redirect here. |
| `/account` | Profile readout + change-password + sign-out (see [design-docs/web-auth-ui.md](./design-docs/web-auth-ui.md)) |
| `/account/organization` | Active org's members, pending invitations (with copyable invite URL), invite form, danger zone (see [design-docs/org-switching.md](./design-docs/org-switching.md)) |
| `/account/invitations` | Incoming pending invitations for the current user (accept/reject) |
| `/accept-invitation/:invitationId` | Deep-link target for shared invite URLs — displays org + inviter + role; accept lands on `/account/organization` (no auto-switch of active org) |
| `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password` | Unauthenticated auth shell (centered card, no `TopChrome`) — see [design-docs/web-auth-ui.md](./design-docs/web-auth-ui.md) |

## Auth shell

`apps/web/src/routes/router.tsx` splits into two top-level branches: an `AuthLayout` branch (centered card, no `TopChrome`) wrapped in `<RedirectIfAuthed />` for the four auth routes, and the existing `AppLayout` branch wrapped in `<RequireAuth />` for everything else. `RequireAuth` redirects to `/sign-in?next=<encoded-current-path>` when `useSession()` resolves with no user, and shows a small loader while it's pending. `RedirectIfAuthed` is the inverse — sends a logged-in user to `?next` (path-prefixed only) or `/` so they don't see the login form.

Form pages use `react-hook-form` + `@hookform/resolvers/zod` + Conduit's design primitives (`.btn`, `.btn.primary`, `.field-input`, `.field-label`, the `--color-claude` accent dot, `font-serif` headings). Each page exports a pure `submit*` helper so the submit logic can be unit-tested in plain `.test.ts` without jsdom or testing-library — see [design-docs/web-auth-ui.md](./design-docs/web-auth-ui.md) for the full surface, the cookie wiring, and the Better Auth client API names (notably `requestPasswordReset`, not `forgetPassword`, in 1.6.9).

## Create from template

The workflow list's header row has a **"From template"** button next to **"New workflow"**. Clicking it opens `TemplatePickerDialog` (`apps/web/src/components/templates/TemplatePickerDialog.tsx`), a two-step modal:

1. **Pick** — grid of template cards (name, category, workflow count, description) sourced from `useTemplates()` → `GET /api/templates`.
2. **Bind** — one row per unique `<alias>` placeholder in the picked template. Each row toggles between **New** (name + credential picker + scope-kind-specific fields — `owner/repo` for `<github-repo>`, `ownerType/owner/number` for `<github-board>`) and **Existing** (pick from connections whose `scope.kind` matches the placeholder's expected slot kind). Submit calls `useCreateFromTemplate()` → `POST /api/workflows/from-template/:id` and navigates to the first created workflow.

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

- **Trigger panel**: platform picker → **Watch** picker (Issues · Pull requests) → **Connections** group with stacked sub-rows (always **Repo**; **Board** is shown under `type: 'issues'` only, starting as a "+ Attach a board" CTA when unset and as a select + `×` detach button when set); each sub-row's picker filters by scope kind (`github_repo` for Repo, `github_projects_v2` for Board) → poll-interval input → readout for the resolved board's title/url/Status fields (when attached) → filter builder. Webhook-typed triggers (legacy data — no creation path in v1) render a read-only banner with the event name and skip the rest. The filter row's left-side dropdown is gated on `(type, hasBoard)`: `type: 'issues'` with a board offers `Status | Label`, `type: 'issues'` without a board offers `Label` only, `type: 'pull_requests'` offers `PR state | Label`. Attaching or detaching a board toggles `Status` availability inline — there's no schema-flip cascade and no dropped-filter toast, since filter validity tracks a reversible user action visible right above. Right-side values stay live-sourced — Status from the selected board's Status column, Label from the source connection's repo via `useListLabels`, and PR state from a fixed `draft / ready_for_review / any` enum. The board list is fetched via `useListProjectBoards` (TanStack Query, keyed on `(connectionId, ownerType, owner)`, 30s `staleTime`); `ownerType` and `owner` come from the selected board connection's parsed `scope`, not user input. `<FilterEditor>`, `<FilterRow>`, `<OptionsValueInput>`, and `<ConnectionSubRow>` all live next to `TriggerConfigPanel` in `apps/web/src/components/canvas/TriggerConfigPanel.tsx`. When the user flips `Watch`, the editor store (`useWorkflowEditor.updateTrigger` in `apps/web/src/state/workflow-editor.ts`) detects the variant change and rebuilds the trigger object — preserving shared fields (`id`, `name`, `platform`, `connectionId`, `boardConnectionId`) and dropping stale variant-specific keys (`event` when leaving webhook; `intervalSec` when entering it).
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
- Credential binding: dropdown to link a `Connection` for auth.

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

- **Top bar**: run metadata (workflow name link, trigger summary, started at, duration, status badge, Cancel button for in-flight runs). The top bar itself is the global `TopChrome` shell — pages publish a `center` and `actions` ReactNode into it via `useTopbarSlots()` (`apps/web/src/state/topbar-slots.ts`). The store identity-checks before setting and uses split per-slot effects so an unchanged slot doesn't churn when the other one changes; memoize the published nodes on the producer side or you defeat both. When `actionsSlot === null`, `TopChrome` renders `<UserMenuPill />` as the default — pill label is the user's name/email, popover contains the active-org line + Switch sub-list + inline Create-organization form, plus Account-settings / Organization-settings / Pending-invitations links and Sign-out (see [design-docs/org-switching.md](./design-docs/org-switching.md)). The old "services healthy" indicator is gone. Pages that override `actionsSlot` (canvas, run detail) keep their override unchanged.
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

- Tailwind v4, custom warm-paper light palette (no preset theme — see [DESIGN.md](./DESIGN.md) for the token layer).
- oklch for status and accent colors; per-provider warm/cool families distinguish Claude (amber) from Codex (teal-green).
- Light surfaces by default. Dense but not cramped.
- Monospace for identifiers, instructions, JSON. Provider-display font is part of the provider token (Claude → sans, Codex → mono).
- Motion: subtle — node status transitions use 150ms fades, no bouncy springs.
