import type { Platform } from '../platform/platform';
import { CREDENTIAL_PLACEHOLDER_VALUE } from './placeholder';
import type { McpTransport } from './transport';

/**
 * One-click starting point for a `WorkflowMcpServer`. The UI renders these
 * as cards in the MCP server picker; clicking a card copies `transport`
 * into the workflow definition and prompts the user to bind a
 * `Connection` whose credential's platform matches `platform`.
 *
 * `transport.env` / `transport.headers` use the `{{credential}}` sentinel,
 * which `resolveMcpServers` substitutes at runtime after decrypting the
 * linked `Connection`'s `Credential.secret`. Same mechanism as user-defined
 * MCP configs — presets get no special handling.
 */
export interface McpPreset {
  /** Stable identifier — UI keys off this, don't change once shipped. */
  id: string;
  name: string;
  description: string;
  /**
   * `Credential.platform` value the preset expects. The UI filters the
   * connection picker to credentials with this platform.
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
      'Read and write GitHub issues, PRs, projects, files, and branches via the remote GitHub MCP server.',
    platform: 'GITHUB',
    credentialHint: 'Personal access token with repo + workflow + project scopes.',
    transport: {
      kind: 'streamable-http',
      url: 'https://api.githubcopilot.com/mcp/',
      headers: {
        Authorization: `Bearer ${CREDENTIAL_PLACEHOLDER_VALUE}`,
        // Opt in to projects on top of the server's default toolset — without
        // this, project-status / project-item tools aren't exposed and agents
        // can't move issues between board columns. Additive: the default
        // toolset (issues, PRs, repos, etc.) stays enabled.
        'X-MCP-Toolsets': 'default,projects',
      },
    },
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    description:
      'Read and write GitLab issues, merge requests, pipelines, wikis, and projects via the @zereight/mcp-gitlab server.',
    platform: 'GITLAB',
    credentialHint: 'Personal access token with api scope.',
    transport: {
      kind: 'stdio',
      command: 'npx',
      args: ['-y', '@zereight/mcp-gitlab'],
      env: {
        GITLAB_PERSONAL_ACCESS_TOKEN: CREDENTIAL_PLACEHOLDER_VALUE,
        GITLAB_API_URL: 'https://gitlab.com/api/v4',
      },
    },
  },
];

/** Lookup by id. Returns undefined for ids the client doesn't know. */
export function findMcpPreset(id: string): McpPreset | undefined {
  return MCP_PRESETS.find((p) => p.id === id);
}

/** Lookup by credential platform. Returns undefined for platforms without a shipped preset. */
export function findMcpPresetByPlatform(platform: Platform): McpPreset | undefined {
  return MCP_PRESETS.find((p) => p.platform === platform);
}
