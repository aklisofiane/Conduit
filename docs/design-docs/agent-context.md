# Agent Context

Inter-agent communication flows through the workspace, not through runtime-injected JSON.

## The shape

Every agent node is invoked with an `AgentContext`:

```ts
type AgentContext = {
  trigger: TriggerEvent;                     // normalized event from the trigger node
  workflow: { id: string; name: string };
  run: { id: string; startedAt: string };
};
```

That's it. No `upstream` field on the type. Upstream context still lives in `.conduit/` files in the workspace — but the runtime now **auto-injects the summaries of a node's direct upstream agents** into its user message, so a node starts already holding what ran immediately before it rather than depending solely on instructions to read those files. See [Direct-upstream auto-injection](#direct-upstream-auto-injection) below.

## How context is delivered

**Trigger context** is serialized as JSON and placed in the **user message** of the provider request. The agent's **system prompt** is the node's `instructions` verbatim — no interpolation, no templating.

Example user message the provider receives:

```json
{
  "trigger": {
    "source": "github",
    "event": "issues.opened",
    "issue": { "number": 42, "title": "Crash in checkout", "body": "...", "labels": ["bug"] },
    "repo": { "owner": "acme", "name": "shop" },
    "actor": "alice"
  },
  "workflow": { "id": "wf_123", "name": "Issue triage & fix" },
  "run": { "id": "run_456", "startedAt": "2026-04-09T14:22:01Z" }
}
```

**Upstream context** arrives two ways, and they stack:

1. **Auto-injected** — the runtime prepends the direct-upstream summaries to the user message as a `## Upstream context` block, above the trigger JSON. The agent holds them from turn one without lifting a finger.
2. **Read on demand** — the agent can still open `.conduit/Triage.md`, `.conduit/Fix.md`, etc. with its file tools when the instructions point it somewhere specific (e.g. a routing manifest a sibling wrote). Injection is *additive*; it never replaces the explicit reads.

## `.conduit/` folder

Each agent writes a freeform `.conduit/<NodeName>.md` summary that downstream agents read — gitignored, deleted at run end, copied between worktrees by the runtime, no schema. The folder contract is owned by [node-system.md](./node-system.md#conduit-folder--inter-agent-communication).

## Referencing upstream in instructions

Users write node instructions in plain prose, e.g.:

> You are the Fix agent. Read `.conduit/Triage.md` for the triage analysis — it will tell you the priority, area, and relevant files. If priority is "low", do nothing. Otherwise, read the flagged files, propose a patch, and commit to a new branch.

The agent reads the `.conduit/` files itself using workspace tools. The instructions are the system prompt, delivered as-is.

## Direct-upstream auto-injection

Sequencing nodes carry an implicit contract: an upstream finishes, writes its summary, and that summary is *handed* to whatever runs next. The runtime makes good on it by injecting direct-upstream summaries into the user turn instead of relying on prompt instructions to pull them in.

**What gets injected.** A node's *direct* DAG-predecessors only — every immediate `from` of an edge into the node, in edge-declaration order, including all branches of a fan-in. No transitive walk (grandparents are not injected), and no fan-in gate (a single upstream still gets injected). Entry nodes have no agent upstream, so their block is empty — trigger→entry edges are filtered out of the agent subgraph before the predecessor set is computed.

**Where it lands.** The block is the **top of the user message**, above the trigger/run JSON — not the system prompt. The system prompt is set once and reused across all of a node's turns (main, optional issue-writeback, summary); upstream summaries are turn-1 *input data*, not role or behavior, so they belong in the user turn where they appear only where relevant and don't bloat the reused system block. Composition happens before the provider request is built, so it is provider-agnostic. (Contrast the *parallel-downstream* block, which **is** behavioral — "you fan out, scope your writes" — and so stays in the system prompt.)

**Best-effort presence.** Injection reads whatever predecessor summaries are already in the node's workspace; a predecessor whose `.conduit/<Name>.md` isn't present is silently skipped. This change consumes the existing copy machinery — it does not alter it. The standard shapes place the files for free:

- **Sequential `inherit`** accumulates `.conduit/` in the shared workspace, so a downstream node sees its predecessor's summary directly.
- **Parallel fan-out** copies the upstream's `.conduit/` into each branched worktree on the way in, and merges sibling summaries back into the shared workspace after the group completes — so a fan-in node reads every branch's summary from the merged path. See [agent-execution.md](./agent-execution.md).

**The seams.** Predecessor computation is a pure topology helper in the shared workflow package (mirror of the parallel-downstream helper), safe for the Temporal V8 sandbox; the workflow passes the resulting name list per node into the run-agent activity; the activity reads each summary from the workspace and prepends the rendered block. All file I/O stays in the activity, never the workflow.

## Why this approach

- **No engine, no schema.** Files in a folder the agents' file tools already reach; freeform markdown, so nothing to define, validate, or retry on mismatch — and LLMs write prose summaries better than structured JSON anyway.
- **Workspace-native.** The workspace is always there; `.conduit/` is just another directory in it.
- **Simple runtime.** No `context.upstream` field, no output parsing. Copying `.conduit/` files between worktrees and injecting direct-upstream summaries into the user turn both operate on the same plain markdown files; neither imposes a schema.
