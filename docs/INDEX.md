# Conduit — Documentation

Agent-first workflow automation for dev teams. Board-driven orchestration, atomic workflows.

## Read order

1. [VISION.md](./VISION.md) — what Conduit is and why
2. [ARCHITECTURE.md](./ARCHITECTURE.md) — system overview, apps, data flow
3. [design-docs/node-system.md](./design-docs/node-system.md) — the 2 node types (trigger, agent)
4. [design-docs/agent-execution.md](./design-docs/agent-execution.md) — how agents run (Temporal + providers + workspaces)
5. [design-docs/mcp-servers.md](./design-docs/mcp-servers.md) — MCP servers as the tool layer
6. [design-docs/agent-context.md](./design-docs/agent-context.md) — inter-agent context via `.conduit/` folder
7. [design-docs/branch-management.md](./design-docs/branch-management.md) — `ticket-branch` workspaces for iterative board loops
8. [design-docs/templates.md](./design-docs/templates.md) — workflow templates shipped as starting points
9. [data-model.md](./data-model.md) — Prisma schema spec
10. [FRONTEND.md](./FRONTEND.md) — canvas (design), run history, run detail page
11. [SECURITY.md](./SECURITY.md) — auth, credentials, sandboxing
12. [RELIABILITY.md](./RELIABILITY.md) — retries, crash recovery, cancellation
13. [PLANS.md](./PLANS.md) — phased rollout
