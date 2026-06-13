import {
  findMcpPreset,
  type AgentConfig,
  type McpServerRef,
  type TriggerConfig,
  type TriggerEvent,
  type WorkflowMcpServer,
} from '@conduit/shared';

/**
 * Pure helpers for issue writeback — kept out of `run-agent-node.ts` so they
 * can be unit-tested without dragging in the activity's Temporal / Prisma /
 * runner imports (same split as `poll-board-helpers.ts`).
 */

/** Reserved id for the auto-attached GitHub MCP server. Underscored to make
 * a collision with a user-defined server vanishingly unlikely. */
export const WRITEBACK_GITHUB_MCP_ID = '__conduit_writeback_github__';

export interface WritebackContext {
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
 * is not configured for this agent, when the workflow has no GitHub trigger,
 * when this run didn't target a GitHub repo, or when the user enabled the
 * checkbox without picking any statuses or labels.
 *
 * A run only needs a GitHub repo to qualify — not a triggering issue. Cron
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
  if (writeback.allowedStatuses.length === 0 && writeback.allowedLabels.length === 0) {
    return undefined;
  }
  if (triggerEvent.source !== 'github') return undefined;
  if (!triggerEvent.repo) return undefined;
  const trigger = triggers.find((t) => t.platform === 'github');
  if (!trigger) return undefined;
  const triggerFilters = 'filters' in trigger ? trigger.filters : [];
  const consumedLabels = triggerFilters
    .filter((f) => f.field === 'label')
    .map((f) => f.value)
    .filter((label) => !writeback.allowedLabels.includes(label));
  return {
    connectionId: trigger.connectionId,
    repoOwner: triggerEvent.repo.owner,
    repoName: triggerEvent.repo.name,
    issueNumber: triggerEvent.issue?.key,
    allowedStatuses: writeback.allowedStatuses,
    allowedLabels: writeback.allowedLabels,
    consumedLabels,
  };
}

/**
 * True when the agent already references a GitHub MCP server defined on the
 * workflow. Matched by transport fingerprint, not id (user-defined ids are
 * arbitrary): the shipped GitHub preset is a remote `streamable-http` server,
 * so a same-`url` match identifies it; a stdio GitHub MCP is matched when it
 * shares package args with the preset. Both are derived from the preset so
 * this stays correct if the transport ever changes. When true, we skip
 * writeback auto-attach so the user-configured server wins — same connection
 * or not. (Without the url branch the auto-attach always fires alongside an
 * existing remote GitHub MCP, leaving the agent with a duplicate, dead
 * `GitHub (writeback)` server.)
 */
export function agentReferencesGithubMcp(
  node: AgentConfig,
  mcpServers: WorkflowMcpServer[],
): boolean {
  const preset = findMcpPreset('github');
  if (!preset) return false;
  const pt = preset.transport;
  const byId = new Map(mcpServers.map((s) => [s.id, s]));
  for (const ref of node.mcpServers) {
    const t = byId.get(ref.serverId)?.transport;
    if (!t || t.kind !== pt.kind) continue;
    // Remote GitHub MCP (the shipped preset): same endpoint ⇒ same server.
    if (t.kind !== 'stdio' && pt.kind !== 'stdio' && t.url === pt.url) return true;
    // stdio GitHub MCP: user points at the same package as the preset.
    if (t.kind === 'stdio' && pt.kind === 'stdio') {
      const presetArgs = pt.args ?? [];
      if (presetArgs.length > 0 && presetArgs.some((a) => (t.args ?? []).includes(a))) {
        return true;
      }
    }
  }
  return false;
}

/** Build the synthetic GitHub MCP server entry + agent ref for auto-attach. */
export function buildSyntheticGithubMcp(connectionId: string): {
  server: WorkflowMcpServer;
  ref: McpServerRef;
} {
  const preset = findMcpPreset('github');
  if (!preset) {
    throw new Error('GitHub MCP preset missing — required for issue writeback auto-attach');
  }
  const server: WorkflowMcpServer = {
    id: WRITEBACK_GITHUB_MCP_ID,
    name: 'GitHub (writeback)',
    transport: preset.transport,
    connectionId,
  };
  const ref: McpServerRef = { serverId: WRITEBACK_GITHUB_MCP_ID };
  return { server, ref };
}
