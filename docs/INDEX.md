# Conduit — Documentation

Agent-first workflow automation for dev teams. Board-driven orchestration, atomic workflows.

## Read order

1. [VISION.md](./VISION.md) — what Conduit is and why
2. [ARCHITECTURE.md](./ARCHITECTURE.md) — system overview, apps, data flow
3. [STRUCTURE.md](./STRUCTURE.md) — repo map: where each responsibility lives
4. [design-docs/node-system.md](./design-docs/node-system.md) — the 2 node types (trigger, agent)
5. [design-docs/agent-execution.md](./design-docs/agent-execution.md) — how agents run (Temporal orchestrator + per-run agent-runner — Docker container or, locally, host process — + providers + workspaces)
6. [design-docs/temporal-id-slug.md](./design-docs/temporal-id-slug.md) — frozen human-readable slug woven into every Temporal id as a cosmetic prefix
7. [design-docs/mcp-servers.md](./design-docs/mcp-servers.md) — MCP servers as the tool layer
8. [design-docs/agent-context.md](./design-docs/agent-context.md) — inter-agent context via `.conduit/` folder
9. [design-docs/branch-management.md](./design-docs/branch-management.md) — `ticket-branch` workspaces for iterative board loops
10. [design-docs/connections.md](./design-docs/connections.md) — Credential + Connection model, typed scope union, workflow webhook secret
11. [design-docs/templates.md](./design-docs/templates.md) — workflow templates shipped as starting points
12. [design-docs/agent-presets.md](./design-docs/agent-presets.md) — reusable agent prompts referenced by templates and the canvas
13. [design-docs/repo-analysis.md](./design-docs/repo-analysis.md) — point Conduit at a repo → per-component review workflows, suggested and ready to import (dedicated Temporal workflow, hidden SYSTEM run host)
14. [design-docs/authentication.md](./design-docs/authentication.md) — **auth umbrella overview**: deployment modes, signup → org-creation flow, the three auth planes, trust contract, RBAC stance, links to all per-feature docs
15. [design-docs/auth-integration.md](./design-docs/auth-integration.md) — Better Auth mount, `SessionGuard`, `/api/auth-config`, harness signup
16. [design-docs/tenant-partitioning.md](./design-docs/tenant-partitioning.md) — `orgId` on every business row, `@OrgId()`, signup-shim, cross-org → 404 convention
17. [design-docs/authorization-enforcement.md](./design-docs/authorization-enforcement.md) — `activeOrganizationId` trust contract, Socket.IO auth on `RunsGateway`, webhook → run org chain, v1 flat-RBAC, membership-staleness window
18. [data-model.md](./data-model.md) — Prisma schema spec
19. [FRONTEND.md](./FRONTEND.md) — canvas (design), run history, run detail page
20. [design-docs/web-auth-ui.md](./design-docs/web-auth-ui.md) — auth route shell, `RequireAuth` boundary, `UserMenuPill`, Better Auth client API surface
21. [design-docs/org-switching.md](./design-docs/org-switching.md) — org switching UI, members + invitations management, copyable invite-URL fallback
22. [design-docs/operational-hardening.md](./design-docs/operational-hardening.md) — Better Auth rate limits, AuditLog model, failed-login spike signal
23. [DESIGN.md](./DESIGN.md) — design tokens, palette, provider styling, the @theme bridge
24. [SECURITY.md](./SECURITY.md) — auth, credentials, sandboxing
25. [RELIABILITY.md](./RELIABILITY.md) — retries, crash recovery, cancellation
26. [VALIDATION.md](./VALIDATION.md) — testing strategy, E2E harness, `StubProvider`
27. [PLANS.md](./PLANS.md) — phased rollout

## Setup recipes

- [setup-oauth.md](./setup-oauth.md) — register an OAuth app with GitHub (or future providers) and wire it into Conduit
