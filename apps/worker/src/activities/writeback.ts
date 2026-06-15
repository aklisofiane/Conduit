import {
  findMcpPresetByPlatform,
  type AgentConfig,
  type McpServerRef,
  type Platform,
  type TriggerConfig,
  type TriggerEvent,
  type WorkflowMcpServer,
} from '@conduit/shared';

/**
 * Pure helpers for issue writeback — kept out of `run-agent-node.ts` so they
 * can be unit-tested without dragging in the activity's Temporal / Prisma /
 * runner imports (same split as `poll-board-helpers.ts`).
 */

/** Platform the writeback path can auto-attach an MCP server for. A subset of
 * `TriggerEvent['source']` — `jira` has no writeback MCP and is rejected by the
 * resolver. */
export type WritebackPlatform = 'github' | 'gitlab';

/** Reserved id for the auto-attached writeback MCP server, per platform.
 * Underscored to make a collision with a user-defined server vanishingly
 * unlikely. The GitHub value is unchanged from when it was a constant, so
 * existing behavior stays byte-identical. */
export function writebackMcpId(platform: WritebackPlatform): string {
  return platform === 'gitlab' ? '__conduit_writeback_gitlab__' : '__conduit_writeback_github__';
}

/** Map a lowercase writeback platform to the uppercase `Platform` enum the MCP
 * presets key off (same convention as `templates.service`). */
function presetPlatform(platform: WritebackPlatform): Platform {
  return platform.toUpperCase() as Platform;
}

export interface WritebackContext {
  /**
   * The firing event's platform (`triggerEvent.source`). Picks the writeback
   * MCP preset and prompt branch; for GitLab it also signals the call site to
   * resolve the instance host. Never `jira` — the resolver rejects sources
   * with no writeback MCP.
   */
  platform: WritebackPlatform;
  connectionId: string;
  repoOwner: string;
  repoName: string;
  /**
   * The triggering issue, when the run was fired by a GitHub issue event
   * (polling / webhook). Undefined for cron runs, which target a repo but no
   * specific issue — writeback is then repo-scoped to whatever issues the
   * agent creates or touches.
   */
  issueNumber?: string;
  allowedStatuses: string[];
  allowedLabels: string[];
  /**
   * PR-native open/closed states the agent may set. Only meaningful when the
   * run is PR-shaped (`isPr`); the prompt emits the directive accordingly.
   */
  allowedPrStates: string[];
  /**
   * True when the triggering event is a pull request (`triggerEvent.pr`
   * present — PR-poll `pull_request.detected` runs and PR webhooks). Switches
   * the writeback prompt to PR wording (`gh pr edit` / `gh pr close|reopen`)
   * and unlocks the `allowedPrStates` directive. False for issue/cron runs.
   */
  isPr: boolean;
  /**
   * Labels the run was gated on (the trigger's `label` filters), minus any
   * the agent is also asked to set. The writeback turn removes these — the
   * stage the run just consumed — so a board handoff swaps one stage label
   * for the next without the template describing the removal. Empty for
   * status-gated entry points (e.g. Analyze on `status=Todo`).
   */
  consumedLabels: string[];
}

/**
 * Resolve the per-run writeback context. Returns undefined when the feature
 * is not configured for this agent, when the workflow has no matching-platform
 * trigger, when this run didn't target a GitHub/GitLab repo, when the firing
 * source has no writeback MCP (e.g. `jira`), or when the user enabled the
 * checkbox without picking any statuses, labels, or PR states.
 *
 * GitHub and GitLab are both admitted; the returned `platform` follows the
 * firing event's source so the call site picks the right preset and prompt
 * branch. A run only needs a repo to qualify — not a triggering issue. Cron
 * runs carry `repo` (resolved from the trigger connection in cron-fire.ts)
 * but no `issue`, so they produce a repo-scoped context with `issueNumber`
 * undefined; the writeback prompt adapts accordingly.
 */
export function resolveWritebackContext(
  node: AgentConfig,
  triggers: TriggerConfig[],
  triggerEvent: TriggerEvent,
): WritebackContext | undefined {
  const writeback = node.issueWriteback;
  if (!writeback) return undefined;
  // Empty allowlist means enabled-but-unselected → skip the whole turn. This
  // also skips consumed-label removal, so a stage must declare at least one
  // status or label for its gating label to be cleared; a pure-removal stage
  // (both allowlists empty) is intentionally unsupported. Every shipped
  // terminal stage sets a status or label, so this never strands a gating
  // label in practice.
  if (
    writeback.allowedStatuses.length === 0 &&
    writeback.allowedLabels.length === 0 &&
    writeback.allowedPrStates.length === 0
  ) {
    return undefined;
  }
  // Only platforms with a shipped writeback MCP qualify; `jira` is rejected.
  if (triggerEvent.source !== 'github' && triggerEvent.source !== 'gitlab') {
    return undefined;
  }
  const platform: WritebackPlatform = triggerEvent.source;
  if (!triggerEvent.repo) return undefined;
  // First trigger on the firing platform. Workflows ship with a single trigger
  // per source, so this is the trigger that fired; if a workflow ever declares
  // more than one, both connectionId and consumedLabels below would follow the
  // first rather than the one that actually fired — revisit with
  // matchesTrigger() (trigger/match) if multi-trigger workflows land.
  const trigger = triggers.find((t) => t.platform === platform);
  if (!trigger) return undefined;
  // consumedLabels is removed in the (issue-scoped) writeback turn, decoupled
  // from any cross-artifact handoff the agent does in prose (e.g. Review's
  // conduit-merge on the PR). If that prose step fails, the gating label is
  // still removed and the ticket can fall out of the pipeline — a known
  // limitation; recovery is manual (re-apply the stage label) until a
  // reconciler sweeps for unlabeled issues with open work.
  const triggerFilters = 'filters' in trigger ? trigger.filters : [];
  const consumedLabels = triggerFilters
    .filter((f) => f.field === 'label')
    .map((f) => f.value)
    .filter((label) => !writeback.allowedLabels.includes(label));
  return {
    platform,
    connectionId: trigger.connectionId,
    repoOwner: triggerEvent.repo.owner,
    repoName: triggerEvent.repo.name,
    issueNumber: triggerEvent.issue?.key,
    allowedStatuses: writeback.allowedStatuses,
    allowedLabels: writeback.allowedLabels,
    allowedPrStates: writeback.allowedPrStates,
    isPr: Boolean(triggerEvent.pr),
    consumedLabels,
  };
}

/**
 * True when the agent already references the firing platform's MCP server
 * defined on the workflow. Matched by transport fingerprint, not id
 * (user-defined ids are arbitrary): the shipped GitHub preset is a remote
 * `streamable-http` server, so a same-`url` match identifies it; the GitLab
 * preset (and any stdio MCP) is matched when it shares package args with the
 * preset. Both are derived from the preset so this stays correct if a
 * transport ever changes. When true, we skip writeback auto-attach so the
 * user-configured server wins — same connection or not. (Without the url
 * branch the auto-attach always fires alongside an existing remote GitHub
 * MCP, leaving the agent with a duplicate, dead `<Provider> (writeback)`
 * server.)
 */
export function agentReferencesWritebackMcp(
  node: AgentConfig,
  mcpServers: WorkflowMcpServer[],
  platform: WritebackPlatform,
): boolean {
  const preset = findMcpPresetByPlatform(presetPlatform(platform));
  if (!preset) return false;
  const pt = preset.transport;
  const byId = new Map(mcpServers.map((s) => [s.id, s]));
  for (const ref of node.mcpServers) {
    const t = byId.get(ref.serverId)?.transport;
    if (!t || t.kind !== pt.kind) continue;
    // Remote MCP (the shipped GitHub preset): same endpoint ⇒ same server.
    if (t.kind !== 'stdio' && pt.kind !== 'stdio' && t.url === pt.url) return true;
    // stdio MCP (the shipped GitLab preset, or a user's stdio GitHub): user
    // points at the same package as the preset.
    if (t.kind === 'stdio' && pt.kind === 'stdio') {
      const presetArgs = pt.args ?? [];
      if (presetArgs.length > 0 && presetArgs.some((a) => (t.args ?? []).includes(a))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Build the synthetic writeback MCP server entry + agent ref for auto-attach,
 * cloned from the firing platform's preset.
 *
 * For **GitLab** a resolved `apiBaseUrl` (the self-hosted instance's
 * `https://<host>/api/v4`) overrides the preset's literal `GITLAB_API_URL`;
 * when omitted the preset's gitlab.com default stands. The
 * `GITLAB_PERSONAL_ACCESS_TOKEN: {{credential}}` placeholder is preserved and
 * still resolves through `makeCredentialLookup` like any other MCP secret.
 * For **GitHub** `apiBaseUrl` is ignored — the preset URL is cloud-only — and
 * the transport is passed through untouched, so its output is byte-identical
 * to the previous GitHub-only builder.
 */
export function buildSyntheticWritebackMcp(args: {
  platform: WritebackPlatform;
  connectionId: string;
  apiBaseUrl?: string;
}): {
  server: WorkflowMcpServer;
  ref: McpServerRef;
} {
  const { platform, connectionId, apiBaseUrl } = args;
  const preset = findMcpPresetByPlatform(presetPlatform(platform));
  if (!preset) {
    throw new Error(`${platform} MCP preset missing — required for issue writeback auto-attach`);
  }
  let transport = preset.transport;
  if (platform === 'gitlab' && apiBaseUrl && transport.kind === 'stdio') {
    transport = {
      ...transport,
      env: { ...(transport.env ?? {}), GITLAB_API_URL: apiBaseUrl },
    };
  }
  const id = writebackMcpId(platform);
  const server: WorkflowMcpServer = {
    id,
    name: platform === 'gitlab' ? 'GitLab (writeback)' : 'GitHub (writeback)',
    transport,
    connectionId,
  };
  const ref: McpServerRef = { serverId: id };
  return { server, ref };
}
