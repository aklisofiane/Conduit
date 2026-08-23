/**
 * Selects how agent providers authenticate inside the runner container.
 *
 *   - `api-key`     (default): credentials travel through `RunnerRequest`
 *                   only — `anthropicApiKey`, `openaiApiKey`, and (for
 *                   Claude OAuth) `claudeCodeOauthToken` from
 *                   `claude setup-token`. No host credential files are
 *                   mounted. Strongest trust boundary.
 *
 *   - `oauth-mount`: additionally bind-mount `~/.codex/auth.json` (only)
 *                   into the container at the same absolute path, and set
 *                   `HOME` so the Codex SDK finds it. **Codex-only** —
 *                   Claude uses `CLAUDE_CODE_OAUTH_TOKEN` and does not
 *                   need any mount. Refreshes propagate back to the host
 *                   file.
 *
 * Materially weaker than `api-key`: a compromised agent can read or
 * rewrite the host's `~/.codex/auth.json`. Don't enable in shared /
 * production environments.
 */
export type AgentAuthMode = 'api-key' | 'oauth-mount';

export function resolveAgentAuthMode(): AgentAuthMode {
  const v = process.env.CONDUIT_AGENT_AUTH;
  if (v === undefined || v === 'api-key') return 'api-key';
  if (v === 'oauth-mount') return 'oauth-mount';
  throw new Error(`CONDUIT_AGENT_AUTH must be 'oauth-mount' or 'api-key' (got "${v}")`);
}
