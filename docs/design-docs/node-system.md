# Node System

The canvas has **two node types**. That's the whole taxonomy.

## 1. Trigger node

Starts a workflow. A trigger is a real graph node — same `id` / `name` shape as agents, addressable by `Edge.from`. The definition stores triggers as `triggers: TriggerConfig[]` and v1 caps the array length at 1, but the plural shape is what every consumer reads (worker `loadGraphActivity`, the canvas, the validator) so multi-trigger lands without another schema migration.

### Trigger types

A trigger's top-level `type` picks *what the user is watching*. The schema is a discriminated union; mechanism (polling vs. webhook delivery) is inferred from the variant rather than authored as a separate axis.

```ts
type TriggerConfig = {
  id: string;                            // stable across renames; used as React Flow node id
  name: string;                          // unique within workflow, shares the namespace with agent names
  platform: 'github' | 'gitlab' | 'jira';
  connectionId: string;                  // required — the source binding (today: a `github_repo` Connection)
  boardConnectionId?: string;            // optional. Presence is load-bearing: under `type: 'issues'` it unlocks
                                         //   board-aware behavior; under `type: 'webhook'` + `event: 'board.column.changed'`
                                         //   it's required by the validator.
  filters: TriggerFilter[];              // per-variant narrowed; e.g. [{ field: 'status', value: 'Dev' }, { field: 'label', value: 'bug' }]
} & TriggerVariant;

type TriggerVariant =
  // Polling-delivered. Optional `boardConnectionId` enables status filter + board-column semantics.
  | { type: 'issues';        intervalSec: number; filters: Array<LabelFilter | StatusFilter> }
  // Polling-delivered, repo-sourced. `boardConnectionId` is allowed but ignored.
  | { type: 'pull_requests'; intervalSec: number; filters: Array<LabelFilter | PrStateFilter> }
  // Schedule-delivered. Fires against a user-selected branch on a cron cadence. No event source, no filters.
  | { type: 'cron';          cron: string; timezone: string; branch: string }
  // Platform-pushed. Preserved in the schema for the dormant `WebhooksController` — NOT exposed in the UI today.
  | { type: 'webhook';       event: string;       filters: Array<LabelFilter | StatusFilter | PrStateFilter> };

type LabelFilter   = { field: 'label';    value: string };                                  // membership against the issue's labels
type StatusFilter  = { field: 'status';   value: string };                                  // exact match against the board's Status column
type PrStateFilter = { field: 'pr_state'; value: 'draft' | 'ready_for_review' | 'any' };    // PR draft state

// `status`/`label` are single-valued strings. Multiple filters on the same trigger combine with AND;
// to require multiple labels, add multiple label rows. The matcher safe-fails on empty `value` so
// in-progress UI rows are persistable without ever matching.
//
// `pr_state` matches the PR's draft state. `'any'` is an explicit always-match (so the UI can show
// a selected value rather than leaning on absence-of-row to mean match-all). Filter validity is
// schema-enforced per variant — the matcher never sees a filter that doesn't belong to the variant.

// `BoardRef` no longer lives on the trigger. The Projects v2 board details are
// carried by the `boardConnectionId`'s `Connection.scope` (`github_projects_v2`:
// `{ ownerType, owner, number }`); the validator only sees the id. Re-exported
// as a type alias from `@conduit/shared/trigger` for legacy call sites.
type BoardRef = Omit<GithubProjectsV2Scope, 'kind'>;
```

**`type: 'cron'`**: a Temporal Schedule fires on a calendar cadence (5-field POSIX cron + IANA timezone). Each tick produces a `TriggerEvent { mode: 'scheduled', event: 'cron.fired' }` with `repo` populated but `issue` and `pr` absent. No filtering, no set-diff dedup — `overlap = SKIP` on the schedule prevents a slow run from overlapping the next tick. Workspace derivation produces `{ kind: 'fixed-branch', branch }` from the trigger config; the branch must exist on the remote.

**`type: 'webhook'`**: platform sends an event to `POST /api/hooks/:workflowId`. Conduit verifies the signature, normalizes the event, checks filters, and starts a run if matched. GitHub webhooks currently normalize four events: `issues.opened`, `pull_request.opened`, `issue_comment.created` (PR-scoped), and `board.column.changed` (from `projects_v2_item.edited` single-select field moves). The `board.column.changed` webhook carries only the Projects v2 item's `content_node_id` — no issue number — so it can't drive a workflow on its own; the `'issues'` variant with a board connection is the supported shape for board-driven flows. The webhook variant is preserved in the schema but **has no UI on-ramp today** — the `WebhooksController` is mounted and `matchesTrigger` honors the `event` name, but no picker creates a webhook trigger. Default-created workflows land on `type: 'issues'`.

**`type: 'issues'`** and **`type: 'pull_requests'`**: a Temporal Schedule fires `pollWorkflow` every `intervalSec` seconds. The activity queries the platform API (GitHub GraphQL for v1) in two phases: a lightweight metadata fetch first (no issue/PR body), then a batched body hydration via `nodes(ids:)` only for items that survive dedup and `matchesTrigger()` filtering. This avoids transferring large bodies for already-seen or filtered-out items. The board-vs-repo dispatch reads `boardConnectionId` presence — no separate `source` axis. See [agent-execution.md](./agent-execution.md#polling-pipeline) for the activity lifecycle.

`type` together with `boardConnectionId` presence picks *what* to watch and *where* to query:

- `type: 'issues'` + `boardConnectionId` set — query the configured Projects v2 board (resolved through the board Connection's scope). The poller keeps items whose `contentType === 'Issue'` and emits `event === 'board.column.changed'` on each new match. Drafts (`DraftIssue`) and PRs that happen to live on the board are filtered out for free. The `status` filter works against the board's Status column.
- `type: 'issues'`, no `boardConnectionId` — query the connection's `repository.issues(states: OPEN)`. Same `event === 'board.column.changed'` for downstream consistency, but `singleSelectValues` is empty (no Status column off-board). The UI only offers the `label` filter in this state; a `status` filter persisted in this state never matches (safe-fail).
- `type: 'pull_requests'` — always repo-sourced. Query the connection's `repository.pullRequests(states: OPEN)`. The poller populates `TriggerEvent.pr` head/base refs (so the workspace manager lands on the PR's branch instead of `conduit/<id>-<slug>`) and emits `event === 'pull_request.detected'`. The new event name is polling-only — webhook PR events keep `pull_request.opened` so consumers can distinguish "GitHub pushed us at PR open" from "the polling tick saw the PR enter the matching set."

#### Dedup for polling

On each poll cycle, Conduit compares the current set of matching issues against the previous poll's set (stored in `PollSnapshot` — one row per workflow, overwritten each cycle within a transaction). Issues that are **new to the set** (not present in the last poll) trigger a run. This handles re-entry naturally: if an issue moves `Dev → Review → Dev`, it drops from the matching set when it leaves `Dev` and reappears as new when it re-enters — triggering again. Simple set diff, no transition history needed from the API.

**No manual run.** There's no "run now" button or endpoint — to test a workflow, configure a polling trigger with a short interval. This keeps the trigger surface uniform: every run, dev or prod, flows through the same webhook or polling path.

### TriggerEvent

Both trigger modes produce the same `TriggerEvent` shape, passed to every downstream node as `context.trigger`:

```ts
type TriggerEvent = {
  source: 'github' | 'gitlab' | 'jira';
  mode: 'webhook' | 'polling' | 'scheduled'; // how the run was triggered
  event: string;                          // e.g. 'status.changed', 'issues.opened', 'cron.fired'
  payload: Record<string, unknown>;       // platform-specific fields, normalized by mapper
  repo?: { owner: string; name: string }; // present for repo-scoped events
  issue?: {
    id: string;                           // platform opaque id (e.g. GitHub node_id)
    key: string;                          // user-visible identifier as a string
    title: string;
    url: string;
    body?: string;                        // issue/PR body at trigger-fire time; capped at 64 KB
  };
  actor?: string;                         // who/what triggered the event
};
```

Each platform has its own mapper that normalizes the raw event/API response into this shape. The Zod schema in `@conduit/shared` is the source of truth for `payload` shapes per platform. `mode: 'scheduled'` guarantees `issue` and `pr` are absent (cron-only).

`issue.id` is the platform's opaque identifier (e.g., GitHub's `node_id`) — used for API calls. `issue.key` is the user-visible identifier as a string: `"42"` for GitHub, `"PROJ-123"` for Jira (matches Jira's native "issue key" term). Downstream code that needs a stable, human-readable ticket identifier (branch names, DB keys, Temporal workflow IDs) reads `issue.key`, never `issue.id`.

`issue.body` carries the issue or PR body text at the time the trigger fired. Bodies exceeding 64 KB are truncated and suffixed with `\n\n[truncated]` so agents can detect the cap. The cap is enforced by `capTriggerBody` (`@conduit/shared/trigger`) and applied uniformly in both polling and webhook paths. Consumers should treat absence as "body unknown" — older triggers and platforms that haven't been wired yet won't carry it.

**UI**: each trigger variant gets its own React Flow node type (`trigger-issues`, `trigger-pull-requests`, `trigger-cron`, `trigger-webhook` placeholder) and focused config panel. Trigger kind is chosen from the `NodePalette` at creation; swapping means delete-then-add. One trigger per workflow — palette cards disable when a trigger exists.

- **Issues panel**: Repo connection → optional Board → interval → filter builder.
- **PR panel**: Repo connection → interval → filter builder (`pr_state` / `label`).
- **Cron panel**: Repo connection → branch (free-text) → cron expression → timezone → active toggle. No filters.
- **Webhook**: read-only placeholder for legacy data — no creation path.

## 2. Agent node

Runs a Claude or Codex session with MCP servers and a workspace.

```ts
type AgentConfig = {
  id: string;
  name: string;                    // unique within workflow, used as .conduit/<name>.md
  provider: AgentProviderId;       // 'claude' | 'codex'
  model: string;                   // e.g. 'claude-opus-4-6', 'gpt-5.3-codex' — see PROVIDER_MODELS / DEFAULT_MODEL in @conduit/shared/agent
  instructions: string;            // system prompt. Plain text.
  mcpServers: McpServerRef[];      // which MCP servers this agent can use
  skills: SkillRef[];              // which skills this agent can use (see "Skills" below)
  webSearch: boolean;              // toggles the provider's built-in web search/fetch (default false). See agent-execution.md
  workspace: WorkspaceSpec;        // always present — Conduit is project-based
  constraints?: {
    maxTurns?: number;
    maxTokens?: number;
    timeoutSec?: number;
    maxToolCalls?: number;
  };
};

type McpServerRef = {
  serverId: string;                // references a server defined at workflow level
  // Optional: restrict which tools from this server the agent can call
  allowedTools?: string[];
};

type WorkspaceSpec =
  | { kind: 'inherit'; fromNode: string }   // reuse upstream agent's workspace (sequential or parallel-branched)
  | { kind: 'ticket-branch' }              // entry kind — issue trigger ⇒ conduit/<id>-<slug>; PR trigger ⇒ pr.headRef
  | { kind: 'fixed-branch'; branch: string }; // entry kind — cron trigger ⇒ user-selected branch
```

**Workspaces are graph-derived.** The user never picks a kind on the canvas — `deriveWorkspaces` computes the shape from edges every time the definition is read at runtime:

- A node connected to a cron trigger → `{ kind: 'fixed-branch', branch: <triggerConfig.branch> }`.
- A node connected to an issue/PR trigger → `{ kind: 'ticket-branch' }`.
- A node with one agent upstream → `{ kind: 'inherit', fromNode: <upstream> }`.
- A node with multiple agent upstreams → `{ kind: 'inherit', fromNode: <topo-latest common ancestor> }`. For `develop.json`'s QA (depends on Dev/Tests/Docs, all sharing Seed) the ancestor is Seed — matching the runtime's parallel merge-back where sibling worktrees converge into Seed before any downstream node reads from it.

Stored `Workflow.definition` JSON omits the `workspace` field entirely; derivation runs at load time.

**What it emits**: a `NodeOutput` — `{ files?: string[], workspacePath: string }`. The agent's actual output to downstream agents is the `.conduit/<NodeName>.md` file it writes in the workspace. No structured JSON output, no schema validation.

### Workspace tools

The provider's **SDK built-in tools** are always enabled — file read/write/edit, shell, glob, grep, etc. Both Claude Agent SDK and Codex SDK have native filesystem tools; no MCP server is needed for workspace access. The workspace path is set as the provider's CWD, scoping all file operations to the workspace root.

**UI**: large node showing name, provider label, model, connected MCP server count. Workspace kind is *not* surfaced on the canvas — it's derived from edges at runtime, not user-authored. Canvas is design-only — runtime data (streamed text, tool calls, counters) lives on the dedicated run detail page. Config panel has instructions editor, MCP server picker, skill picker, constraints.

### MCP servers at the workflow level

Workflows declare their available MCP servers in the definition:

```ts
type WorkflowMcpServer = {
  id: string;                      // referenced by agent nodes
  name: string;                    // display name
  transport: McpTransport;
  // Credential binding: which workflow connection provides auth for this server
  connectionId?: string;
  // Cached tool list from last introspection (populated by /mcp/introspect)
  discoveredTools?: DiscoveredTool[];
};

type DiscoveredTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;           // JSON Schema
};

type McpTransport =
  | { kind: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  | { kind: 'sse';   url: string; headers?: Record<string, string> }
  | { kind: 'streamable-http'; url: string; headers?: Record<string, string> };
```

Conduit ships a set of **preset MCP server configs** (GitHub, Slack, filesystem, etc.) that users can add with one click. Users can also add any custom MCP server by providing a transport config.

Credentials are injected as environment variables when spawning `stdio` servers, or as headers for `sse`/`streamable-http` servers — resolved from the linked `Connection` (and through to its `Credential`) at runtime. See [connections.md](./connections.md).

### Workspace inheritance

The key primitive for multi-agent pipelines. If *Triage* lands the ticket's worktree and classifies the issue, an edge `Triage → Fix` causes derivation to emit `{ kind: 'inherit', fromNode: 'Triage' }` for *Fix* — which then operates on the same worktree (sequential), or its own branch off the upstream's HEAD (parallel fan-out), with sibling worktrees squash-merged back one at a time afterward. Runtime details — sequential vs. parallel resolution, the deterministic sequential merge-back, and `.conduit/` copy — live in [agent-execution.md](./agent-execution.md#parallel-execution--merge-back). A merge that conflicts aborts the run (`MergeConflictError`); there is no automatic resolution in v1.

Rule: `inherit` always points at the trigger-connected entry node or another `inherit` — there are no other arms in the schema. The derivation guarantees the upstream exists (it walks the edge graph) so this is structurally enforced, not separately validated.

### `ticket-branch` workspaces

One of two entry kinds. Two arms inside the resolver, dispatched by the trigger event:

- **Issue trigger** (`issues.opened` webhook, polling on board status): persists a branch `conduit/<ticket-id>-<slug>` across runs on the same ticket. The slug is derived from the issue title on first create and cached in the `TicketBranch` row, so iteration N+1 reads the same branch name. Each run adds a worktree from the current remote branch state, so iteration N+1 sees iteration N's commits.
- **PR trigger** (`pull_request.opened` webhook or `pull_request.detected` from PR-scope polling): lands directly on `pr.headRef`. No row is created — the head ref is the canonical name. For Conduit-internal flows where a Worker pushed and opened a PR, this naturally lands the Reviewer on the same `conduit/<id>-<slug>` branch the Worker built; for external/human-opened PRs, on whatever branch the contributor opened from.

The agent commits and pushes via normal git; runtime sets up the push auth in-env at activity start, and the push env + credential helper flow through the inherit chain so any agent in the chain can `git push`. Ownership, the branch-naming spec, who-pushes convention, the "nobody pushed" footgun, and concurrency all live in [branch-management.md](./branch-management.md); runtime resolution details: see [agent-execution.md](./agent-execution.md#runagentnode-lifecycle).

### `fixed-branch` workspaces

Entry kind for cron triggers. The trigger config names the branch; the resolver checks out a worktree on it. The branch must already exist on the remote. No `TicketBranch` row, no slug derivation, no per-tick ephemeral branch in v1 — agents work directly on the user-selected branch. Downstream `inherit` behaves identically to `ticket-branch` inheritance.

### Skills

Skills are reusable instruction bundles that extend an agent's capabilities. Both Claude Agent SDK and Codex SDK support skills natively via `SKILL.md` files with YAML frontmatter (`name`, `description`) and markdown instructions.

```ts
type SkillRef = {
  skillId: string;     // references a discovered skill
  source: 'repo' | 'worker';  // where the skill was found
};
```

**Discovery**: Conduit scans two locations for available skills:
- **Repo-level**: `.claude/skills/` and `.agents/skills/` in the connected repository
- **Worker-level**: `~/.claude/skills/` and `~/.agents/skills/` on the worker host

The API reads each `SKILL.md` frontmatter (name, description) and returns the list. The UI displays available skills in the agent config panel for the user to attach.

**Runtime**: before invoking the provider, the runtime copies only the selected skills into the workspace's skill directory (`.claude/skills/` for Claude, `.agents/skills/` for Codex). The SDK discovers them automatically from there. Skills not selected by the user are not copied — the agent only sees what was explicitly attached.

**No custom skill authoring in v1.** Users work with skills already present in their repo or on the worker. A skill editor could come later.

### `.conduit/` folder — inter-agent communication

Each agent writes a summary file to `.conduit/<NodeName>.md` in the workspace as a final step. Content is freeform markdown: what the agent did, issues encountered, anything relevant for downstream agents. Downstream agents read the `.conduit/` folder from the workspace to get context from upstream agents — and the runtime additionally auto-injects each node's direct-upstream summaries into its user turn (see [agent-context.md](./agent-context.md#direct-upstream-auto-injection)).

- `.conduit/` is **gitignored** — never committed. Ephemeral, internal-only.
- Deleted at the end of the workflow run.
- No schema, no validation. Agents write what they want; downstream agents read what they need.

## Edges

Edges carry no config. They declare execution order — node B runs after node A, and can read A's `.conduit/A.md` summary from the workspace. Multiple edges into the same node = that node waits for all of them.

```ts
type Edge = {
  from: string;   // source node name — may reference a trigger or an agent
  to: string;     // destination node name — must reference an agent
};
```

`Edge.from` resolves against the union of trigger and agent names (validated in `workflowDefinitionSchema`); `Edge.to` is restricted to agents — triggers can't be edge destinations. Trigger→agent edges are first-class: nothing is auto-synthesized at render or run time, so an agent dropped on the canvas without an inbound edge is an orphan and won't execute.

**No conditional edges.** Branching lives inside agents (an agent can decide to do nothing). Keeping edges dumb keeps the graph model tiny.

### Edge selection and deletion

The canvas renders edges through a custom `WorkflowEdge` (`apps/web/src/components/canvas/WorkflowEdge.tsx`): clicking an edge selects it and overlays a small × button at its midpoint; pressing Backspace with an edge selected removes it the same way. Both paths flow through React Flow's `onEdgesChange` `remove` event so there is exactly one edge-delete code path — `flowEdgesToDomain` rebuilds `WorkflowDefinition.edges` from the surviving React Flow state.

### Execution semantics

The Temporal workflow scopes the topo-sort to the subgraph reachable from a trigger:

1. `loadGraphActivity` returns `{ triggers, nodes, edges, ... }`.
2. The workflow splits edges into trigger→agent (entry edges) and agent→agent.
3. `topoSortGroups(nodes, agentEdges, entryNames)` runs Kahn over the agent subgraph, where `entryNames` are the agents directly downstream of any trigger. Agents not transitively reachable from an entry are dropped from the schedule — orphans on the canvas are silently skipped at runtime, never executed.
4. Cycles entirely outside the reachable subgraph are ignored; cycles within it throw.

## Workflow definition shape

The full `Workflow.definition` JSON stored in the DB:

```ts
type WorkflowDefinition = {
  triggers: TriggerConfig[];       // length === 1 in v1; plural-ready
  nodes: AgentConfig[];            // agent nodes
  edges: Edge[];                   // may originate from a trigger or an agent
  mcpServers: WorkflowMcpServer[]; // declared at workflow level, referenced by agent nodes
  ui: CanvasUI;                    // canvas positions + viewport (frontend-only state)
};

type CanvasUI = {
  nodePositions: Record<string, { x: number; y: number }>;  // keyed by node name
  viewport: { x: number; y: number; zoom: number };
};

type NodeOutput = {
  files?: string[];        // paths changed in workspace (repo-rooted)
  workspacePath: string;   // used downstream for inherit
};
```

`AgentConfig.id` is an internal identifier stable across renames (for React keys, edge bookkeeping); `AgentConfig.name` is the user-editable identifier used everywhere else (`.conduit/<name>.md`, `NodeRun.nodeName`, edge `from`/`to`). Renaming a node rewrites all references (edges, `workspace.inherit.fromNode`) in the definition atomically at save time.

## Validation rules (enforced at save)

1. At most one trigger (`triggers.length > 1` is rejected; zero is a legal in-flight state during the swap-by-delete UX — the API gate `assertActivatable` prevents an empty-trigger workflow from activating).
2. Trigger and agent names are unique within their combined namespace and are valid identifiers (`^[A-Za-z_][A-Za-z0-9_]*$`). A name collision between a trigger and an agent is rejected.
3. Every `Edge.from` references a known trigger or agent; every `Edge.to` references an agent (triggers can't be edge destinations).
4. No cycles within a single workflow graph. Cross-run cycles — via board transitions that re-trigger the same workflow — are the intended loop mechanism; see [branch-management.md](./branch-management.md#core-principle-the-board-is-the-loop).
5. Agents are *allowed* to be unreachable from any trigger — orphans don't fail save, they just don't execute (the runtime topo-sort drops them). This keeps edits incremental: dropping an agent on the canvas before wiring it doesn't immediately invalidate the workflow.
6. Every trigger surfaces an issue or PR identifier — `type: 'webhook'` triggers whose `event` doesn't carry one (`push`, `release`, `workflow_run`, `board.column.changed`) are rejected. `type: 'issues'` and `type: 'pull_requests'` always pull issue identity from the GraphQL response and pass unconditionally.
7. All triggers in a workflow share the same `connectionId` (and the same `boardConnectionId`, when present). v1 has a single trigger today; multi-trigger workflows must still target a single repo + at most one board connection.
8. Every `mcpServers[].serverId` references a server defined at the workflow level.
9. MCP servers with a `connectionId` must reference a valid `Connection`.
10. Cron expression validated as 5-field POSIX; `timezone` and `branch` must be non-empty. Temporal validates IANA timezone at schedule create time.
11. `cron-trigger-incompatible-workspace`: a cron-triggered node cannot have `workspace.kind === 'ticket-branch'` (catches legacy/hand-edited JSON).
12. `boardConnectionId` is required only for `type: 'webhook'` with `event === 'board.column.changed'` — the validator emits `trigger-board-connection-required` in that case. `type: 'issues'` does **not** require a board: with no `boardConnectionId` the poller takes the repo path; attaching one progressively unlocks the board-aware semantics (Status filter, column-change detection). `type: 'pull_requests'` derives owner/repo from the source `Connection` (`scope.kind: 'github_repo'`) and ignores the board slot. See [connections.md](./connections.md).

## Cross-run iteration

Iteration across runs is expressed by **board transitions, not cycles in the graph** — the polling set-diff dedup ([Dedup for polling](#dedup-for-polling)) re-fires when a ticket re-enters a matching column, and the persistent `conduit/<ticket>` branch makes the iteration stateful. The full board-loop model is owned by [branch-management.md](./branch-management.md#core-principle-the-board-is-the-loop) and [VISION.md](../VISION.md#core-principles).
