# Node System

The canvas has **two node types**. That's the whole taxonomy.

## 1. Trigger node

Starts a workflow. A trigger is a real graph node — same `id` / `name` shape as agents, addressable by `Edge.from`. The definition stores triggers as `triggers: TriggerConfig[]` and v1 caps the array length at 1, but the plural shape is what every consumer reads (worker `loadGraphActivity`, the canvas, the validator) so multi-trigger lands without another schema migration.

### Trigger modes

A trigger can operate in **webhook** mode (event-driven push) or **polling** mode (interval-based pull). Both use the same filter logic.

```ts
type TriggerConfig = {
  id: string;                            // stable across renames; used as React Flow node id
  name: string;                          // unique within workflow, shares the namespace with agent names
  platform: 'github' | 'gitlab' | 'jira';
  connectionId: string;
  mode: TriggerMode;
  filters: TriggerFilter[];              // e.g. [{ field: 'status', value: 'Dev' }, { field: 'label', value: 'bug' }]
  board?: BoardRef;                      // required for polling mode + `board.column.changed` webhook
};

type TriggerMode =
  | { kind: 'webhook'; event: string }        // platform pushes events (e.g. 'issues.opened', 'board.column.changed')
  | { kind: 'polling';                        // Conduit polls the platform API on an interval (default 60s)
      intervalSec: number;
      scope: 'issues' | 'pull_requests';      // what to watch (default 'issues')
      source: 'board' | 'repo';               // where to query — default 'board' (issue scope only; PR scope always repo)
    };

type BoardRef = {
  ownerType: 'user' | 'org';  // GitHub Projects v2 are owned by a user or an org
  owner: string;              // the login of that user/org
  number: number;             // Projects v2 project number (scoped to owner)
};

type TriggerFilter =
  | { field: 'status'; value: string }                                    // exact match against the issue/PR's Status column
  | { field: 'label'; value: string }                                     // membership: row matches if `value` is in the issue's labels
  | { field: 'pr_state'; value: 'draft' | 'ready_for_review' | 'any' };   // polling + scope=pull_requests only

// `status`/`label` are single-valued strings. Multiple filters on the same trigger combine with AND;
// to require multiple labels, add multiple label rows. The matcher safe-fails on empty `value` so
// in-progress UI rows are persistable without ever matching.
//
// `pr_state` matches the PR's draft state. `'any'` is an explicit always-match (so the UI can show
// a selected value rather than leaning on absence-of-row to mean match-all). Filter availability is
// scope-aware in the UI: issue triggers offer `status` + `label`; PR triggers offer `pr_state` +
// `label`. The schema accepts all three regardless of mode — per-scope exclusion is a UI concern.
```

**Webhook mode**: platform sends an event to `POST /api/hooks/:workflowId`. Conduit verifies the signature, normalizes the event, checks filters, and triggers a run if matched. GitHub webhooks currently normalize four events: `issues.opened`, `pull_request.opened`, `issue_comment.created` (PR-scoped), and `board.column.changed` (from `projects_v2_item.edited` single-select field moves). The `board.column.changed` webhook carries only the Projects v2 item's `content_node_id` — no issue number — so it can't drive a workflow on its own; polling is the supported mode for board-driven flows.

**Polling mode**: a Temporal Schedule fires `pollWorkflow` every `intervalSec` seconds. The activity queries the platform API (GitHub GraphQL for v1), filters on the returned items, and triggers a run for each matching item that hasn't been processed for this specific transition yet. The query target is picked by `mode.scope` and `mode.source` (see below); only `scope: 'issues'` + `source: 'board'` reads `TriggerConfig.board` — repo-sourced issue polling and PR-scope polling derive the repo from the connection. See [agent-execution.md](./agent-execution.md#polling-pipeline) for the activity lifecycle.

`mode.scope` and `mode.source` together pick *what* to watch and *where* to query:

- `scope: 'issues'` + `source: 'board'` (default) — query the configured Projects v2 board. The poller keeps items whose `contentType === 'Issue'` and emits `event === 'board.column.changed'` on each new match. Drafts (`DraftIssue`) and PRs that happen to live on the board are filtered out for free. The `status` filter works against the board's Status column.
- `scope: 'issues'` + `source: 'repo'` — query the connection's `repository.issues(states: OPEN)`. No board ref needed. Same `event === 'board.column.changed'` for downstream consistency, but `singleSelectValues` is empty (no Status column off-board); the UI hides the `status` filter accordingly.
- `scope: 'pull_requests'` — always repo-sourced. Query the connection's `repository.pullRequests(states: OPEN)`. The poller populates `TriggerEvent.pr` head/base refs (so the workspace manager lands on the PR's branch instead of `conduit/<id>-<slug>`) and emits `event === 'pull_request.detected'`. The new event name is polling-only — webhook PR events keep `pull_request.opened` so consumers can distinguish "GitHub pushed us at PR open" from "the polling tick saw the PR enter the matching set." The `source` field is allowed but ignored under PR scope.

`scope` and `source` both default via Zod (`'issues'`, `'board'`) so triggers persisted before either field existed round-trip to the prior board-issue behavior.

#### Dedup for polling

On each poll cycle, Conduit compares the current set of matching issues against the previous poll's set (stored in `PollSnapshot` — one row per workflow, overwritten each cycle within a transaction). Issues that are **new to the set** (not present in the last poll) trigger a run. This handles re-entry naturally: if an issue moves `Dev → Review → Dev`, it drops from the matching set when it leaves `Dev` and reappears as new when it re-enters — triggering again. Simple set diff, no transition history needed from the API.

**No manual run.** There's no "run now" button or endpoint — to test a workflow, configure a polling trigger with a short interval. This keeps the trigger surface uniform: every run, dev or prod, flows through the same webhook or polling path.

### TriggerEvent

Both trigger modes produce the same `TriggerEvent` shape, passed to every downstream node as `context.trigger`:

```ts
type TriggerEvent = {
  source: 'github' | 'gitlab' | 'jira';
  mode: 'webhook' | 'polling';            // how the run was triggered
  event: string;                          // e.g. 'status.changed', 'issues.opened'
  payload: Record<string, unknown>;       // platform-specific fields, normalized by mapper
  repo?: { owner: string; name: string }; // present for repo-scoped events
  issue?: { id: string; key: string; title: string; url: string }; // present for issue-scoped events — `key` is the user-visible identifier as a string
  actor?: string;                         // who/what triggered the event
};
```

Each platform has its own mapper that normalizes the raw event/API response into this shape. The Zod schema in `@conduit/shared` is the source of truth for `payload` shapes per platform.

`issue.id` is the platform's opaque identifier (e.g., GitHub's `node_id`) — used for API calls. `issue.key` is the user-visible identifier as a string: `"42"` for GitHub, `"PROJ-123"` for Jira (matches Jira's native "issue key" term). Downstream code that needs a stable, human-readable ticket identifier (branch names, DB keys, Temporal workflow IDs) reads `issue.key`, never `issue.id`.

**UI**: one node at the top of the canvas, no input handles, one output handle. Config panel shows: platform picker → connection picker → mode toggle (webhook / polling) → event picker (webhook) or interval config (polling) → filter builder.

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
  | { kind: 'ticket-branch' };              // entry kind — issue trigger ⇒ conduit/<id>-<slug>; PR trigger ⇒ pr.headRef
```

**Workspaces are graph-derived.** The user never picks a kind on the canvas — `deriveWorkspaces` computes the shape from edges every time the definition is read at runtime:

- A node connected to a trigger → `{ kind: 'ticket-branch' }`. The connection is the workflow's single trigger connection (validated at save-time).
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

Credentials are injected as environment variables when spawning `stdio` servers, or as headers for `sse`/`streamable-http` servers — resolved from the linked `WorkflowConnection` at runtime.

### Workspace inheritance

The key primitive for multi-agent pipelines. If *Triage* lands the ticket's worktree and classifies the issue, an edge `Triage → Fix` causes derivation to emit `{ kind: 'inherit', fromNode: 'Triage' }` for *Fix* — which then operates on the same worktree. The runtime:

- For **sequential** inheritance: passes the worktree path directly.
- For **parallel** inheritance (fan-out): each downstream node gets its **own worktree branched from the upstream's HEAD**, so parallel agents don't stomp on each other.

**Merge-back after parallel execution**: after all parallel agents in a group complete, the runtime runs merge-back steps **sequentially** as separate activities — one agent at a time merges its worktree back to the target branch, resolving conflicts. Since `.conduit/` is gitignored, the runtime copies `.conduit/` files from each parallel worktree into the target workspace after merging code (simple file copy, no git involved).

Rule: `inherit` always points at the trigger-connected entry node or another `inherit` — there are no other arms in the schema. The derivation guarantees the upstream exists (it walks the edge graph) so this is structurally enforced, not separately validated.

### `ticket-branch` workspaces

The sole entry kind. Two arms inside the resolver, dispatched by the trigger event:

- **Issue trigger** (`issues.opened` webhook, polling on board status): persists a branch `conduit/<ticket-id>-<slug>` across runs on the same ticket. The slug is derived from the issue title on first create and cached in the `TicketBranch` row, so iteration N+1 reads the same branch name. Each run adds a worktree from the current remote branch state, so iteration N+1 sees iteration N's commits.
- **PR trigger** (`pull_request.opened` webhook or `pull_request.detected` from PR-scope polling): lands directly on `pr.headRef`. No row is created — the head ref is the canonical name. For Conduit-internal flows where a Worker pushed and opened a PR, this naturally lands the Reviewer on the same `conduit/<id>-<slug>` branch the Worker built; for external/human-opened PRs, on whatever branch the contributor opened from.

The agent commits and pushes via normal git; runtime sets up the push auth in-env at activity start. See [branch-management.md](./branch-management.md) for ownership, lifecycle, and concurrency.

Agents inheriting from a `ticket-branch` upstream — sequentially or via parallel fan-out — receive the same push env and credential helper; any agent in the chain can `git push`. Convention is that the agent responsible for the final commit also pushes, typically after reading upstream `.conduit/` summaries and handling ticket/comment updates. The runtime does not enforce which agent pushes — DAGs with multiple terminal agents work fine (fast-forward push is idempotent) — and the unpushed-commits check at run end surfaces the "nobody pushed" footgun. Save-time enforcement of a single designated pusher is deferred; see [PLANS.md](../PLANS.md).

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

Each agent writes a summary file to `.conduit/<NodeName>.md` in the workspace as a final step. Content is freeform markdown: what the agent did, issues encountered, anything relevant for downstream agents. Downstream agents read the `.conduit/` folder from the workspace to get context from upstream agents.

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

1. Exactly one trigger (`triggers.length === 1` in v1; the schema is plural so this becomes a soft cap when multi-trigger lands).
2. Trigger and agent names are unique within their combined namespace and are valid identifiers (`^[A-Za-z_][A-Za-z0-9_]*$`). A name collision between a trigger and an agent is rejected.
3. Every `Edge.from` references a known trigger or agent; every `Edge.to` references an agent (triggers can't be edge destinations).
4. No cycles within a single workflow graph. Cross-run cycles — via board transitions that re-trigger the same workflow — are the intended loop mechanism; see "Cross-run iteration" below.
5. Agents are *allowed* to be unreachable from any trigger — orphans don't fail save, they just don't execute (the runtime topo-sort drops them). This keeps edits incremental: dropping an agent on the canvas before wiring it doesn't immediately invalidate the workflow.
6. Every trigger surfaces an issue or PR identifier — webhook events that don't (`push`, `release`, `workflow_run`, `board.column.changed`) are rejected. Polling-mode triggers always pull issue identity from the GraphQL response and pass unconditionally.
7. All triggers in a workflow share the same `connectionId`. v1 has a single trigger today; multi-trigger workflows must still target a single repo connection.
8. Every `mcpServers[].serverId` references a server defined at the workflow level.
9. MCP servers with a `connectionId` must reference a valid `WorkflowConnection`.
10. Polling-mode triggers require `TriggerConfig.board` only under `scope: 'issues'` + `source: 'board'`; the `pollBoardActivity` throws at tick time if it's missing under that combination. PR-scope and `source: 'repo'` polling derive the repo from the connection and ignore `board`. Webhook-mode triggers may omit it unless `event === 'board.column.changed'` (which is rejected by rule 6 anyway in v1).

## Cross-run iteration

Iteration across runs is expressed by **board transitions, not cycles in the graph**. A Worker workflow fires on `status = Dev`, commits to the ticket branch, and moves the ticket to `AIReview`. A Critic workflow fires on `status = AIReview`, reviews the branch, and either approves or moves the ticket back to `Dev` — which re-triggers the Worker.

The polling trigger's set-diff dedup (see [Dedup for polling](#dedup-for-polling) above) is what makes this natural: when a ticket re-enters a matching column it looks "new to the set" and triggers again. That existing behavior is the loop primitive; the persistent `conduit/<ticket>` branch is what makes the iteration stateful.

Webhook triggers also re-enter — each column move fires its own event — but without polling's dedup layer they're more exposed to storm scenarios. Polling is the more robust mode for board-loop workflows in v1.
