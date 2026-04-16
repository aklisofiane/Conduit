# Vision

## What Conduit is

A workflow automation platform for dev teams where **agents are the primary unit of work** and **the board is the orchestrator**. Workflows are atomic units triggered by board events (column moves, issue opens, PR opens) on GitHub Projects, GitLab boards, or Jira. Each workflow runs uninterrupted — no pauses, no gates. Cross-workflow state flows through the issue itself: one workflow writes to the issue description, the next reads it. Agents move issues between columns, post comments, and open PRs via MCP tools. Temporal provides durable execution.

Think: *"n8n's canvas UX, but every node is a Claude/Codex session with a workspace and a toolbelt, triggered by your project board."*

## Core principles

- **Board is the orchestrator.** GitHub Projects / GitLab / Jira boards define the state machine. The team moves issues between columns (e.g., Todo → Analyze → Dev → Review → Done). Each column transition can trigger a Conduit workflow.
- **Workflows are atomic.** Triggered by a board event, run uninterrupted, finish by taking an action (move issue, post comment, open PR). No pauses mid-workflow.
- **Agents do the work.** Platform integrations (GitHub, Slack, etc.) are tools the agent calls — not separate node types. One powerful node type beats a library of thin wrappers.
- **Cross-workflow context flows through the issue.** The Analyze workflow updates the issue description with its analysis; the Fix workflow reads it. No Conduit-level cross-workflow state needed.
- **Completion = agent action.** The workflow's agent moves the issue to the next column, posts a comment, opens a PR — all via MCP tools. No special "on-complete" workflow config.
- **`.conduit/` folder for inter-agent handoff.** Each agent writes a freeform markdown summary to `.conduit/<NodeName>.md` in the workspace. Downstream agents read it directly. No schemas, no JSON validation, no runtime injection — agents communicate through the workspace.
- **Canvas for orchestration.** The visual editor earns its keep for multi-agent pipelines: fan-out, parallel execution, workspace inheritance. Not for chaining API calls.
- **Temporal for durability.** Long-running agent sessions need heartbeats, crash recovery, cancellation, and retries. Temporal provides all of this out of the box.

## Success criteria for v1

1. A user can: define a GitHub trigger → write one agent with instructions + selected tools → watch it run live on a new issue, end-to-end.
2. A user can: build a 3-agent pipeline (Triage → Fix → Review), run it in parallel where possible, see each agent's tool calls stream live.
3. Multi-agent workspace handoff works (Fix agent can operate on the worktree Triage prepared).
4. A workflow triggered by a board column move can analyze an issue and move it to the next column via MCP tools.

## Non-goals (v1)

- Custom agent provider SDK (Claude + Codex only for v1)
- Visual debugging of tool calls mid-run beyond the live trace
- Multi-tenant / org-level RBAC
- GitLab / Jira board triggers (GitHub first; platform abstraction layer planned from the start)
