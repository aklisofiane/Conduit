# Node System

The canvas has **two node types**. That's the whole taxonomy.

## 1. Trigger node

Starts a workflow. One per workflow (v1 — multi-trigger deferred).

### Trigger modes

A trigger can operate in **webhook** mode (event-driven push) or **polling** mode (interval-based pull). Both use the same filter logic.

```ts
type TriggerConfig = {
  platform: 'github' | 'gitlab' | 'jira';
  connectionId: string;
  mode: TriggerMode;
  filters: TriggerFilter[];              // e.g. [{ field: 'status', op: 'eq', value: 'Dev' }]
  board?: BoardRef;                      // required for polling mode + `board.column.changed` webhook
};

type TriggerMode =
  | { kind: 'webhook'; event: string; active: boolean }        // platform pushes events (e.g. 'issues.opened', 'board.column.changed')
  | { kind: 'polling'; intervalSec: number; active: boolean }; // Conduit polls the board API on an interval (default 60s)

type BoardRef = {
  ownerType: 'user' | 'org';  // GitHub Projects v2 are owned by a user or an org
  owner: string;              // the login of that user/org
  number: number;             // Projects v2 project number (scoped to owner)
};

type TriggerFilter = {
  field: string;       // e.g. 'status', 'label', 'assignee'
  op: 'eq' | 'neq' | 'in' | 'contains';
  value: string | string[];
};

// Operator semantics:
// - 'eq' / 'neq': value is string, exact match (case-sensitive).
// - 'in':         value is string[], field must equal any entry.
// - 'contains':   value is string, substring match on field (case-sensitive).
// Multiple filters on the same trigger combine with AND.
```

**Webhook mode**: platform sends an event to `POST /api/hooks/:workflowId`. Conduit verifies the signature, normalizes the event, checks filters, and triggers a run if matched. GitHub webhooks currently normalize four events: `issues.opened`, `pull_request.opened`, `issue_comment.created` (PR-scoped), and `board.column.changed` (from `projects_v2_item.edited` single-select field moves). The `board.column.changed` webhook carries only the Projects v2 item's `content_node_id` — no issue number — so `ticket-branch` workspaces cannot use this event (polling is the supported mode for those).

**Polling mode**: a Temporal Schedule fires `pollWorkflow` every `intervalSec` seconds. The activity queries the platform API (GitHub Projects v2 GraphQL for v1 — the `TriggerConfig.board` reference picks which project), filters on the returned items, and triggers a run for each matching item that hasn't been processed for this specific transition yet. Polling mode **requires** `TriggerConfig.board` — the poller has nothing to query without it. See [agent-execution.md](./agent-execution.md#polling-pipeline) for the activity lifecycle.

#### Dedup for polling

On each poll cycle, Conduit compares the current set of matching issues against the previous poll's set (stored in `PollSnapshot` — one row per workflow, overwritten each cycle within a transaction). Issues that are **new to the set** (not present in the last poll) trigger a run. This handles re-entry naturally: if an issue moves `Dev → Review → Dev`, it drops from the matching set when it leaves `Dev` and reappears as new when it re-enters — triggering again. Simple set diff, no transition history needed from the API.

**Manual run**: any workflow can be run manually from the UI via `POST /api/workflows/:id/run`. This is a dev/debug action available on every workflow, not a trigger mode configured in `TriggerConfig`. The user can optionally provide a specific issue/PR to run against. Manual runs produce a `TriggerEvent` with `mode: 'manual'` so the agent knows how it was triggered.

### TriggerEvent

All trigger modes (including manual runs) produce the same `TriggerEvent` shape, passed to every downstream node as `context.trigger`:

```ts
type TriggerEvent = {
  source: 'github' | 'gitlab' | 'jira';
  mode: 'webhook' | 'polling' | 'manual'; // how the run was triggered (manual is not a TriggerMode — it's a runtime action)
  event: string;                          // e.g. 'status.changed', 'issues.opened', 'manual.run'
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
  provider: 'claude' | 'codex';
  model: string;                   // e.g. 'claude-opus-4-6', 'gpt-5-codex'
  instructions: string;            // system prompt. Plain text.
  mcpServers: McpServerRef[];      // which MCP servers this agent can use
  skills: SkillRef[];              // which skills this agent can use (see "Skills" below)
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
  | { kind: 'fresh-tmpdir' }                                           // empty sandbox (no repo, edge case)
  | { kind: 'repo-clone'; connectionId: string; ref?: string }         // seeded from base clone, ephemeral
  | { kind: 'inherit'; fromNode: string }                              // reuse upstream agent's workspace
  | { kind: 'ticket-branch'; connectionId: string; baseRef?: string }; // persistent branch scoped to a ticket
```

**What it emits**: a `NodeOutput` — `{ files?: string[], workspacePath: string }`. The agent's actual output to downstream agents is the `.conduit/<NodeName>.md` file it writes in the workspace. No structured JSON output, no schema validation.

### Workspace tools

The provider's **SDK built-in tools** are always enabled — file read/write/edit, shell, glob, grep, etc. Both Claude Agent SDK and Codex SDK have native filesystem tools; no MCP server is needed for workspace access. The workspace path is set as the provider's CWD, scoping all file operations to the workspace root.

**UI**: large node showing name, provider label, model, connected MCP server count, workspace kind. Canvas is design-only — runtime data (streamed text, tool calls, counters) lives on the dedicated run detail page. Config panel has instructions editor, MCP server picker, skill picker, workspace picker, constraints.

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

The key primitive for multi-agent pipelines. If *Triage* clones a repo and classifies an issue, *Fix* can declare `workspace: { kind: 'inherit', fromNode: 'Triage' }` and operate on the same worktree. The runtime:

- For **sequential** inheritance: passes the worktree path directly.
- For **parallel** inheritance (fan-out): each downstream node gets its **own worktree branched from the upstream's HEAD**, so parallel agents don't stomp on each other.

**Merge-back after parallel execution**: after all parallel agents in a group complete, the runtime runs merge-back steps **sequentially** as separate activities — one agent at a time merges its worktree back to the target branch, resolving conflicts. Since `.conduit/` is gitignored, the runtime copies `.conduit/` files from each parallel worktree into the target workspace after merging code (simple file copy, no git involved).

Rule: `inherit` requires the upstream node to have `kind: 'repo-clone'`, `ticket-branch`, or another `inherit`. Validated at workflow save time.

### `ticket-branch` workspaces

The primitive for iterative board-loop workflows (Worker↔Critic). Unlike `repo-clone`, which is ephemeral per-run, `ticket-branch` persists a branch (`conduit/<ticket-id>-<slug>`) across runs on the same ticket. Each run adds a worktree from the current branch state, so iteration N+1 sees iteration N's commits. The agent commits and pushes via normal git; runtime sets up the push auth in-env at activity start. See [branch-management.md](./branch-management.md) for ownership, lifecycle, and concurrency.

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
  from: string;   // source node name
  to: string;     // destination node name
};
```

**No conditional edges.** Branching lives inside agents (an agent can decide to do nothing). Keeping edges dumb keeps the graph model tiny.

## Workflow definition shape

The full `Workflow.definition` JSON stored in the DB:

```ts
type WorkflowDefinition = {
  trigger: TriggerConfig;          // exactly one
  nodes: AgentConfig[];            // agent nodes (trigger is implicit in the single trigger field)
  edges: Edge[];
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

1. Exactly one trigger node.
2. All node names unique and valid identifiers (`^[A-Za-z_][A-Za-z0-9_]*$`).
3. No cycles within a single workflow graph. Cross-run cycles — via board transitions that re-trigger the same workflow — are the intended loop mechanism; see "Cross-run iteration" below.
4. Every non-trigger node is reachable from the trigger.
5. `workspace.inherit.fromNode` points to an ancestor with a `repo-clone`, `ticket-branch`, or `inherit` workspace.
6. Every `mcpServers[].serverId` references a server defined at the workflow level.
7. MCP servers with a `connectionId` must reference a valid `WorkflowConnection`.
8. `ticket-branch` workspaces require a trigger that produces a populated `triggerEvent.issue`. Validated against the trigger's platform + event type at save time — webhook events that don't carry an issue (e.g., `push`, `release`, `workflow_run`, `board.column.changed`) fail validation when combined with `ticket-branch`.
9. Polling-mode triggers require `TriggerConfig.board` to be populated. Webhook-mode triggers may omit it unless `event === 'board.column.changed'`, which also needs it so the poller / column-move handler knows which Projects v2 board to read.

## Cross-run iteration

Iteration across runs is expressed by **board transitions, not cycles in the graph**. A Worker workflow fires on `status = Dev`, commits to a `ticket-branch`, and moves the ticket to `AIReview`. A Critic workflow fires on `status = AIReview`, reviews the branch, and either approves or moves the ticket back to `Dev` — which re-triggers the Worker.

The polling trigger's set-diff dedup (see [Dedup for polling](#dedup-for-polling) above) is what makes this natural: when a ticket re-enters a matching column it looks "new to the set" and triggers again. That existing behavior is the loop primitive; `ticket-branch` is what makes the iteration stateful.

Webhook triggers also re-enter — each column move fires its own event — but without polling's dedup layer they're more exposed to storm scenarios. Polling is the more robust mode for board-loop workflows in v1.
