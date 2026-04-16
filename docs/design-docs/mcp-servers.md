# MCP Servers

Tools in Conduit are **MCP servers** — no custom tool registry, no proprietary tool manifest format. The [Model Context Protocol](https://modelcontextprotocol.io) is the standard; we use it directly.

Both Claude Agent SDK and Codex SDK support MCP natively. **Conduit does not manage MCP lifecycle** — it only stores configs and hands them to the SDK. The SDK spawns processes, opens connections, invokes tools, and tears everything down.

## How it works

1. **Workflow defines available MCP servers** in `definition.mcpServers[]` — each with a transport config and optional credential binding.
2. **Agent nodes reference servers** via `mcpServers[].serverId` — optionally restricting which tools from that server they can call.
3. **At runtime**, `runAgentNode` resolves credentials (decrypt + substitute) and passes the final MCP config to the SDK.
4. **The SDK** (Claude or Codex) handles everything from here — spawning, connecting, tool discovery, invocation, cleanup.

## Presets

Conduit ships preset configs for common MCP servers that users can add with one click from the UI:

| Preset | Server | Transport | Required credential |
|---|---|---|---|
| GitHub | `@modelcontextprotocol/server-github` | stdio | GitHub PAT |
| GitLab | `@modelcontextprotocol/server-gitlab` | stdio | GitLab PAT |
| Slack | `@modelcontextprotocol/server-slack` | stdio | Slack Bot Token |
| PostgreSQL | `@modelcontextprotocol/server-postgres` | stdio | Connection string |
| Brave Search | `@modelcontextprotocol/server-brave-search` | stdio | Brave API key |

Presets are just pre-filled `WorkflowMcpServer` configs — no special handling. Users can edit them or add entirely custom servers.

Note: **filesystem/shell tools are not MCP servers**. When an agent node has a workspace, the provider's SDK built-in tools (file read/write/edit, shell, glob, grep) are enabled automatically. MCP servers are for *external platform integrations* (GitHub, Slack, databases, search, etc.).

## Config shape

```ts
// stdio
{
  id: 'my-custom-server',
  name: 'Internal API',
  transport: {
    kind: 'stdio',
    command: 'npx',
    args: ['-y', '@myorg/mcp-internal-api'],
    env: { API_KEY: '{{credential}}' }  // resolved from connection at runtime
  },
  connectionId: 'conn_xyz'
}

// SSE / Streamable HTTP
{
  id: 'remote-server',
  name: 'Remote Tools',
  transport: {
    kind: 'streamable-http',
    url: 'https://tools.example.com/mcp',
    headers: { 'Authorization': 'Bearer {{credential}}' }
  },
  connectionId: 'conn_abc'
}
```

The `{{credential}}` placeholder in env/headers resolves to the decrypted secret from the linked `WorkflowConnection` at runtime. Simple string replacement, not a template engine.

## Credential resolution

Before passing the MCP config to the SDK, `runAgentNode`:

1. Looks up `connectionId` on the `WorkflowMcpServer`.
2. Decrypts the linked `PlatformCredential.secret`.
3. Substitutes `{{credential}}` in `env` (stdio) or `headers` (SSE/HTTP).
4. Passes the resolved config to the SDK.

Credential plaintext only exists in memory during config resolution and inside the SDK-managed MCP process. Never logged, never persisted.

## Tool discovery

At runtime, the agent SDK discovers tools when it connects to the MCP server. But the UI needs the tool list **at config time** so users can pick which ones to allow. Conduit solves this with a dedicated introspection endpoint.

**Flow:**
1. User adds an MCP server config in the UI (preset or custom).
2. UI calls `POST /api/mcp/introspect` with the resolved config (credentials substituted in-memory).
3. The API uses `@modelcontextprotocol/sdk` — the official MCP TypeScript client, a peer dep of both Claude Agent SDK and Codex SDK — to briefly connect to the server, call `tools/list`, collect tool metadata (name, description, input schema), and disconnect.
4. The UI displays the tools as checkboxes for `allowedTools` selection.
5. Tool list is **cached** in the `WorkflowMcpServer` config (`discoveredTools` field) alongside the user's `allowedTools` selection. A "Refresh tools" button re-introspects.

This keeps discovery decoupled from the agent SDKs — we don't need Claude or Codex running just to list tools.

## Tool filtering

An agent node can restrict which tools it sees from a given MCP server:

```ts
mcpServers: [
  { serverId: 'github', allowedTools: ['create_issue', 'list_issues', 'add_comment'] },
  { serverId: 'filesystem' }  // all tools
]
```

If `allowedTools` is omitted, the agent sees all tools from that server. This is a safety measure (a Triage agent shouldn't have `merge_pull_request`) and a prompt quality measure (fewer tools = better tool selection). `allowedTools` is passed to the SDK, which enforces it.

## Isolation

MCP servers are **per-agent-node**. Each agent gets its own SDK-managed instances — no sharing between nodes. This keeps state isolated.

## Why MCP, not a custom registry

- **No code to write per tool.** Adding GitHub support = preset config. No handlers, no manifest types.
- **Existing ecosystem.** Hundreds of MCP servers already exist.
- **SDK-native.** Both Claude Agent SDK and Codex SDK support MCP natively. Zero adapter code.
- **User extensibility from day one.** "Add a custom MCP server" is a v1 feature.

## Idempotency

MCP servers don't guarantee idempotency — that's the server's responsibility.

- **Read operations**: trivially idempotent.
- **Write operations on retries** (worker crash → activity re-run): we recommend MCP servers that support idempotency keys, but can't enforce it across arbitrary servers.
- **Best practice**: for workflows handling untrusted trigger sources, use `allowedTools` to restrict destructive tools and design the board so destructive steps require a reviewer to move the issue (board-level review).
