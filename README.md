# Conduit

Workflow automation platform for dev teams where agents are the primary unit of work and the board is the orchestrator.

Conduit connects to your project board (GitHub Projects, GitLab boards, Jira) and triggers agentic workflows when issues move between columns. Each workflow runs one or more AI agents (Claude, Codex) that can read code, make changes, call external tools via MCP servers, and move issues to the next stage. Your team stays in control at the board level — review agent output, approve results, and decide what happens next.

## How it works

1. An issue moves to a column on your board (e.g., "To Fix")
2. Conduit detects the change (via webhook or polling) and triggers the associated workflow
3. Agents execute — reading the issue, analyzing code, making changes, posting comments, opening PRs
4. The workflow completes and moves the issue to the next column (e.g., "Review")
5. The team reviews the agent's work on the board and decides where the issue goes next

## Key concepts

- **Board-driven orchestration** — your project board defines the state machine, Conduit runs the workflows
- **Two node types** — triggers and agents. That's it.
- **MCP servers as tools** — agents call GitHub, Slack, databases, and any MCP-compatible server
- **Skills** — reusable instruction bundles from Claude Code and Codex, attachable to agents
- **Workspace-native** — every agent operates on a git workspace with full file and shell access
- **Multi-agent pipelines** — fan-out, parallel execution, workspace inheritance, sequential merge-back
- **Run observability** — live timeline of agent events (text, tools, tokens) on the run detail page
- **Temporal for durability** — crash recovery, retries, cancellation out of the box

## Documentation

See [docs/INDEX.md](docs/INDEX.md) for the full spec.

## License

[MIT](LICENSE)
