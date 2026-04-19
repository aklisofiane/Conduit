# Conduit — Documentation

Agent-first workflow automation for dev teams. Board-driven orchestration, atomic workflows.

## Read order

1. [VISION.md](./VISION.md) — what Conduit is and why
2. [ARCHITECTURE.md](./ARCHITECTURE.md) — system overview, apps, data flow
3. [STRUCTURE.md](./STRUCTURE.md) — repo map: where each responsibility lives
4. [design-docs/node-system.md](./design-docs/node-system.md) — the 2 node types (trigger, agent)
5. [design-docs/agent-execution.md](./design-docs/agent-execution.md) — how agents run (Temporal + providers + workspaces)
6. [design-docs/mcp-servers.md](./design-docs/mcp-servers.md) — MCP servers as the tool layer
7. [design-docs/agent-context.md](./design-docs/agent-context.md) — inter-agent context via `.conduit/` folder
8. [design-docs/branch-management.md](./design-docs/branch-management.md) — `ticket-branch` workspaces for iterative board loops
9. [design-docs/templates.md](./design-docs/templates.md) — workflow templates shipped as starting points
10. [data-model.md](./data-model.md) — Prisma schema spec
11. [FRONTEND.md](./FRONTEND.md) — canvas (design), run history, run detail page
12. [SECURITY.md](./SECURITY.md) — auth, credentials, sandboxing
13. [RELIABILITY.md](./RELIABILITY.md) — retries, crash recovery, cancellation
14. [VALIDATION.md](./VALIDATION.md) — testing strategy, E2E harness, `StubProvider`
15. [PLANS.md](./PLANS.md) — phased rollout
