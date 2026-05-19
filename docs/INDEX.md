# Conduit — Documentation

Agent-first workflow automation for dev teams. Board-driven orchestration, atomic workflows.

## Read order

1. [VISION.md](./VISION.md) — what Conduit is and why
2. [ARCHITECTURE.md](./ARCHITECTURE.md) — system overview, apps, data flow
3. [STRUCTURE.md](./STRUCTURE.md) — repo map: where each responsibility lives
4. [design-docs/node-system.md](./design-docs/node-system.md) — the 2 node types (trigger, agent)
5. [design-docs/agent-execution.md](./design-docs/agent-execution.md) — how agents run (Temporal orchestrator + per-run agent-runner container + providers + workspaces)
6. [design-docs/mcp-servers.md](./design-docs/mcp-servers.md) — MCP servers as the tool layer
7. [design-docs/agent-context.md](./design-docs/agent-context.md) — inter-agent context via `.conduit/` folder
8. [design-docs/branch-management.md](./design-docs/branch-management.md) — `ticket-branch` workspaces for iterative board loops
9. [design-docs/connections.md](./design-docs/connections.md) — Credential + Connection model, typed scope union, workflow webhook secret
10. [design-docs/templates.md](./design-docs/templates.md) — workflow templates shipped as starting points
11. [design-docs/agent-presets.md](./design-docs/agent-presets.md) — reusable agent prompts referenced by templates and the canvas
12. [design-docs/authentication.md](./design-docs/authentication.md) — **auth umbrella overview**: deployment modes, signup → org-creation flow, the three auth planes, trust contract, RBAC stance, links to all per-feature docs
13. [design-docs/auth-integration.md](./design-docs/auth-integration.md) — Better Auth mount, `SessionGuard`, `/api/auth-config`, harness signup
14. [design-docs/tenant-partitioning.md](./design-docs/tenant-partitioning.md) — `orgId` on every business row, `@OrgId()`, signup-shim, cross-org → 404 convention
15. [design-docs/authorization-enforcement.md](./design-docs/authorization-enforcement.md) — `activeOrganizationId` trust contract, Socket.IO auth on `RunsGateway`, webhook → run org chain, v1 flat-RBAC, membership-staleness window
16. [data-model.md](./data-model.md) — Prisma schema spec
17. [FRONTEND.md](./FRONTEND.md) — canvas (design), run history, run detail page
18. [design-docs/web-auth-ui.md](./design-docs/web-auth-ui.md) — auth route shell, `RequireAuth` boundary, `UserMenuPill`, Better Auth client API surface
19. [design-docs/org-switching.md](./design-docs/org-switching.md) — org switching UI, members + invitations management, copyable invite-URL fallback
20. [design-docs/operational-hardening.md](./design-docs/operational-hardening.md) — Better Auth rate limits, AuditLog model, failed-login spike signal
21. [DESIGN.md](./DESIGN.md) — design tokens, palette, provider styling, the @theme bridge
22. [SECURITY.md](./SECURITY.md) — auth, credentials, sandboxing
23. [RELIABILITY.md](./RELIABILITY.md) — retries, crash recovery, cancellation
24. [VALIDATION.md](./VALIDATION.md) — testing strategy, E2E harness, `StubProvider`
25. [PLANS.md](./PLANS.md) — phased rollout

## Setup recipes

- [setup-oauth.md](./setup-oauth.md) — register an OAuth app with GitHub (or future providers) and wire it into Conduit
