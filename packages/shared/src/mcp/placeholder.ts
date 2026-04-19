/**
 * Placeholder substituted in MCP transport `env` / `headers` values at
 * runtime. Lives in `@conduit/shared` so presets (this package) and the
 * resolver (`@conduit/agent/mcp`) stay in lockstep — renaming here forces
 * both to update in one commit.
 */
export const CREDENTIAL_PLACEHOLDER_VALUE = '{{credential}}';
