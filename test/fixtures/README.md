# Test fixtures

Seed data used by the validation harness. See [docs/VALIDATION.md](../../docs/VALIDATION.md).

| Directory | Purpose |
|---|---|
| `workflows/` | Workflow definitions (JSON) that can be POSTed to `/api/workflows` to set up a deterministic graph for a test. |
| `repos/` | Tarballs of bare git repos seeded with commit history. Extracted into a tmpdir and used as the remote for `repo-clone` / `ticket-branch` tests. No network access required. Added in Phase 2. |
| `events/` | Captured webhook payloads (GitHub issue opened, PR opened, PR comment, project column moved). Added in Phase 2. |
| `mcp-stub/` | A tiny stdio MCP server (`server.mjs`) used in place of real servers like `@modelcontextprotocol/server-github`. Exposes `echo`, `add`, `fail` — enough to exercise introspection and tool-call paths. |

## Conventions

- Workflow fixtures use `"stub-model"` as the model string so tests make it obvious the `StubProvider` is in play.
- Each fixture is self-contained: no cross-references, no environment assumptions.
- Tests that mutate a fixture (e.g., rename, add a node) should deep-clone it first.
