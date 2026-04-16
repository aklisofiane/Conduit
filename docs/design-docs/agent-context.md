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

That's it. No `upstream` field. Downstream agents get upstream context by reading `.conduit/` files from the workspace.

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

**Upstream context** is in the workspace. The agent reads `.conduit/Triage.md`, `.conduit/Fix.md`, etc. using its built-in file tools. The instructions tell it where to look.

## `.conduit/` folder

Each agent writes `.conduit/<NodeName>.md` in the workspace as a final step. Content is freeform markdown with light guidelines:

- What the agent did
- Issues encountered
- Anything relevant for downstream agents

The `.conduit/` folder is:
- **Gitignored** — never committed. Ephemeral, internal-only.
- **Deleted** at the end of the workflow run.
- **Copied** by the runtime from parallel worktrees into the target workspace after merge-back (since it's not part of git).

No schema, no validation. Agents write what they want; downstream agents read what they need.

## Referencing upstream in instructions

Users write node instructions in plain prose, e.g.:

> You are the Fix agent. Read `.conduit/Triage.md` for the triage analysis — it will tell you the priority, area, and relevant files. If priority is "low", do nothing. Otherwise, read the flagged files, propose a patch, and commit to a new branch.

The agent reads the `.conduit/` files itself using workspace tools. The instructions are the system prompt, delivered as-is.

## Why this approach

- **No engine needed.** Files in a folder. Agents already have file tools.
- **No schema burden.** Agents write freeform markdown. No JSON Schema to define, validate, or retry on mismatch.
- **Natural for agents.** LLMs are good at reading and writing prose summaries. Better than forcing structured JSON.
- **Workspace-native.** The workspace is always there. `.conduit/` is just another directory in it.
- **Simple runtime.** No `context.upstream` injection, no output parsing, no schema validation. The runtime just ensures `.conduit/` files get copied between parallel worktrees.
