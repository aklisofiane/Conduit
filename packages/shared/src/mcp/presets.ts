import type { Platform } from '../platform/platform';
import { CREDENTIAL_PLACEHOLDER_VALUE } from './placeholder';
import type { McpTransport } from './transport';

/**
 * One-click starting point for a `WorkflowMcpServer`. The UI renders these
 * as cards in the MCP server picker; clicking a card copies `transport`
 * into the workflow definition and prompts the user to bind a
 * `WorkflowConnection` whose credential's platform matches `platform`.
 *
 * `transport.env` / `transport.headers` use the `{{credential}}` sentinel,
 * which `resolveMcpServers` substitutes at runtime after decrypting the
 * linked `PlatformCredential.secret`. Same mechanism as user-defined MCP
 * configs — presets get no special handling.
 */
export interface McpPreset {
  /** Stable identifier — UI keys off this, don't change once shipped. */
  id: string;
  name: string;
  description: string;
  /**
   * `PlatformCredential.platform` value the preset expects. The UI filters
   * the connection picker to credentials with this platform.
   */
  platform: Platform;
  /**
   * Short label for the credential the user needs (e.g. "Personal access
   * token with `repo` + `issues:write` scopes"). Rendered inline so users
   * don't have to chase docs.
   */
  credentialHint: string;
  /**
   * Transport template. `env` / `headers` values may contain
   * `{{credential}}` which resolves to the decrypted secret at runtime.
   */
  transport: McpTransport;
}

/**
 * Presets shipped with Conduit. Phase 2 ships GitHub only — Slack,
 * PostgreSQL, and Brave Search land with other Phase 7 deliverables.
 * See docs/design-docs/mcp-servers.md.
 */
export const MCP_PRESETS: readonly McpPreset[] = [
  {
    id: 'github',
    name: 'GitHub',
    description:
      'Read and write GitHub issues, PRs, files, and branches via the official GitHub MCP server.',
    platform: 'GITHUB',
    credentialHint: 'Personal access token with repo + workflow scopes.',
    transport: {
      kind: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: CREDENTIAL_PLACEHOLDER_VALUE,
      },
    },
  },
];

/** Lookup by id. Returns undefined for ids the client doesn't know. */
export function findMcpPreset(id: string): McpPreset | undefined {
  return MCP_PRESETS.find((p) => p.id === id);
}
