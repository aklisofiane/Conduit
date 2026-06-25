import { Context } from '@temporalio/activity';
import {
  WorkspaceManager,
  baseClonesRoot,
  buildAgentContext,
  clearConduitFolder,
  discoverSkills,
  finalSummaryPrompt,
  formatParallelDownstreamBlock,
  formatUpstreamContextBlock,
  installPushCredentials,
  installSkillsIntoWorkspace,
  issueWritebackPrompt,
  readConduitSummary,
  resolveMcpServers,
  runDir,
  serializeAgentContext,
  touchWorktreeHeartbeat,
} from '@conduit/agent';
import {
  type AgentConfig,
  type AgentConfigWithWorkspace,
  type AgentEvent,
  type AgentRequest,
  type NodeOutput,
  type TriggerConfig,
  type TriggerEvent,
  type WorkflowMcpServer,
} from '@conduit/shared';
import type { RunnerEvent, RunnerRequest } from '@conduit/shared/runner';
import { gitlabApiUrl } from '@conduit/shared/platform';
import type {
  ConnectionContext,
  PrContext,
  TicketBranchStore,
  TicketContext,
} from '@conduit/agent';
import { config } from '../config';
import { loadConnectionContext, loadConnectionHost } from '../runtime/connection-context';
import { makeCredentialLookup } from '../runtime/credential-lookup';
import { publishRunUpdate } from '../runtime/event-bus';
import { writeAgentEventLog, writeSystemLog } from '../runtime/log-writer';
import { prisma } from '../runtime/prisma';
import { loadProviderConfig } from '../runtime/provider-config';
import { resolveRunnerSpawner } from '../runtime/runner';
import { makeTicketBranchStore } from '../runtime/ticket-branch-store';
import { abortableDelay, resolveWithGraceWindow } from './branch-busy-wait';
import {
  agentReferencesWritebackMcp,
  buildSyntheticWritebackMcp,
  resolveWritebackContext,
} from './writeback';

export interface RunAgentNodeInput {
  workflowId: string;
  workflowName: string;
  /** Tenant scope — chained through from `loadGraphActivity` so derived rows
   *  (NodeRun, ExecutionLog) carry the same orgId as the parent run. */
  orgId: string;
  runId: string;
  /** Workspace populated by `deriveWorkspaces` upstream of this activity. */
  node: AgentConfigWithWorkspace;
  mcpServers: WorkflowMcpServer[];
  /** Workflow triggers — used to resolve the GitHub trigger's connection for issue-writeback and ticket-branch workspaces. */
  triggers: TriggerConfig[];
  triggerEvent: TriggerEvent;
  /** Populated when the node has a `workspace.inherit.fromNode`. */
  upstreamWorkspacePath?: string;
  /** Upstream worktree HEAD — passed through to the workspace manager for parallel branching. */
  upstreamHead?: string;
  /**
   * True when the node is one of several siblings inheriting the same
   * upstream in a parallel group. Tells the workspace manager to carve a
   * throwaway branched worktree instead of passing the upstream path
   * through.
   */
  parallelBranch?: boolean;
  /**
   * Names of the node's *immediate* downstream siblings when this node fans
   * out (>1 outgoing edge). Empty/undefined for leaf or single-downstream
   * nodes. The activity formats this into a small "Parallel downstream"
   * section appended to the agent's system prompt so a planner-style agent
   * can dispatch responsibilities by sibling name without us having to
   * hardcode the DAG into every preset.
   */
  parallelDownstream?: string[];
  /**
   * Names of the node's *direct* upstream agents (immediate DAG-predecessors,
   * including every branch of a fan-in), in edge-declaration order. The
   * activity reads each one's `.conduit/<name>.md` summary from the workspace
   * and prepends it to the main user turn, so a node starts already holding
   * what ran before it instead of relying on prompt instructions to read it.
   * Empty/undefined for entry nodes.
   */
  directUpstream?: string[];
}

/**
 * The workhorse activity. One invocation per agent node. Resolves workspace
 * and run inputs, hands a `RunnerRequest` to the spawner, and translates
 * each returned `RunnerEvent` back into the existing log/event-bus/NodeRun
 * flow. Idempotent up to the workspace step — Temporal retries re-enter
 * from the top; real agent runs are not resumable mid-session.
 */
export async function runAgentNode(input: RunAgentNodeInput): Promise<NodeOutput> {
  const {
    runId,
    orgId,
    node,
    workflowId,
    workflowName,
    mcpServers,
    triggers,
    triggerEvent,
    upstreamWorkspacePath,
    upstreamHead,
    parallelBranch,
    parallelDownstream,
    directUpstream,
  } = input;
  const ctx = Context.current();
  const workspaceManager = new WorkspaceManager();

  const nodeRun = await prisma().nodeRun.upsert({
    where: { runId_nodeName: { runId, nodeName: node.name } },
    update: { status: 'RUNNING', startedAt: new Date() },
    create: {
      runId,
      orgId,
      nodeName: node.name,
      nodeType: 'AGENT',
      status: 'RUNNING',
      startedAt: new Date(),
    },
  });

  try {
    const entryInputs = await resolveEntryWorkspaceInputs(node, triggers, triggerEvent);

    // A concurrent run resolving the same ticket-branch may hold it live;
    // resolution then fails fast with BranchBusyError. Wait out a bounded
    // grace window here (the Temporal heartbeater hasn't started yet, so we
    // emit heartbeats from the loop), failing the node only if the owner
    // doesn't release within the deadline.
    const workspace = await resolveWithGraceWindow(
      () =>
        workspaceManager.resolve({
          runId,
          nodeName: node.name,
          spec: node.workspace,
          orgId,
          connection: entryInputs?.connection,
          upstreamPath: upstreamWorkspacePath,
          upstreamHead,
          parallelBranch,
          ticket: entryInputs?.ticket,
          ticketBranchStore: entryInputs?.store,
          pr: entryInputs?.pr,
        }),
      {
        sleep: (ms) => abortableDelay(ms, ctx.cancellationSignal),
        now: () => Date.now(),
        heartbeat: (info) => ctx.heartbeat({ nodeName: node.name, ...info }),
      },
    );

    // Claim the worktree for liveness: a fresh heartbeat tells a concurrent
    // run resolving the same ticket-branch that this run is alive, so its
    // eviction throws BranchBusyError instead of stealing our cwd. Refreshed
    // by the heartbeater below for the duration of the agent session.
    await touchWorktreeHeartbeat(workspace.path);

    if (workspace.ticketBranchId) {
      await entryInputs?.store?.markRunStart(workspace.ticketBranchId);
    }

    // Installed on the shared .git/config so inherit-chain children pick it
    // up automatically; cleanupRunActivity wipes the run dir after.
    const entryWithToken =
      (workspace.kind === 'ticket-branch' || workspace.kind === 'fixed-branch') &&
      entryInputs?.connection?.token;
    if (entryWithToken && entryInputs?.connection?.token) {
      await installPushCredentials({
        runId,
        nodeName: node.name,
        worktreePath: workspace.path,
        token: entryInputs.connection.token,
      });
    }

    const startupMessage = systemMessage(node, workspace.path, parallelBranch);
    await Promise.all([
      publishSystemEvent(runId, node.name, startupMessage),
      writeSystemLog(runId, orgId, node.name, startupMessage),
    ]);

    const skills = node.skills.length > 0 ? await discoverSkills({ cwd: workspace.path }) : [];
    const selected = skills.filter((s) => node.skills.some((r) => r.skillId === s.id));
    if (selected.length) {
      await installSkillsIntoWorkspace(workspace.path, selected, node.provider);
    }

    // Skip auto-attach if the firing platform's MCP is already referenced —
    // the user-configured one wins, regardless of which connection it uses.
    const writebackContext = resolveWritebackContext(node, triggers, triggerEvent);
    let writebackAttach: ReturnType<typeof buildSyntheticWritebackMcp> | null = null;
    if (
      writebackContext &&
      !agentReferencesWritebackMcp(node, mcpServers, writebackContext.platform)
    ) {
      // Self-hosted GitLab varies the API base by instance, so the synthetic
      // MCP needs the credential's host; gitlab.com normalizes to the preset's
      // default URL (the override is then a no-op). GitHub needs no host — its
      // preset URL is cloud-only — so it skips the lookup entirely.
      let apiBaseUrl: string | undefined;
      if (writebackContext.platform === 'gitlab') {
        const host = await loadConnectionHost(writebackContext.connectionId);
        apiBaseUrl = host ? gitlabApiUrl(host) : undefined;
      }
      writebackAttach = buildSyntheticWritebackMcp({
        platform: writebackContext.platform,
        connectionId: writebackContext.connectionId,
        apiBaseUrl,
      });
    }
    const effectiveNode: AgentConfig = writebackAttach
      ? { ...node, mcpServers: [...node.mcpServers, writebackAttach.ref] }
      : node;
    const effectiveMcpServers: WorkflowMcpServer[] = writebackAttach
      ? [...mcpServers, writebackAttach.server]
      : mcpServers;

    const resolvedMcp = await resolveMcpServers(
      effectiveNode,
      effectiveMcpServers,
      makeCredentialLookup(),
    );

    const abortController = new AbortController();
    ctx.cancellationSignal.addEventListener('abort', () => abortController.abort());

    const agentCtx = buildAgentContext({
      trigger: triggerEvent,
      workflow: { id: workflowId, name: workflowName },
      run: { id: runId, startedAt: nodeRun.startedAt ?? new Date() },
    });

    // Auto-inject direct-upstream handoff summaries into the main user turn.
    // A predecessor whose `.conduit/<name>.md` isn't present in this workspace
    // is skipped — but logged as a WARN, since running without a predecessor's
    // handoff context wastes tokens on uninformed work (the copy machinery
    // places summaries for the standard sequential/fan-in shapes). A hard read
    // error (permissions, corrupted path) instead throws and fails the node
    // outright. Read in edge-declaration order.
    const upstreamReads = await Promise.all(
      (directUpstream ?? []).map(async (name) => ({
        name,
        body: await readConduitSummary(workspace.path, name),
      })),
    );
    const upstreamSummaries = upstreamReads
      .filter((r): r is { name: string; body: string } => r.body !== null)
      .map((r) => ({ nodeName: r.name, body: r.body }));
    const missingUpstream = upstreamReads.filter((r) => r.body === null).map((r) => r.name);
    if (missingUpstream.length > 0) {
      await writeSystemLog(
        runId,
        orgId,
        node.name,
        `direct-upstream handoff summary missing, skipped: ${missingUpstream.join(', ')}`,
        'WARN',
      );
    }
    const upstreamBlock = formatUpstreamContextBlock(upstreamSummaries);
    const mainPrompt = upstreamBlock
      ? `${upstreamBlock}\n\n${serializeAgentContext(agentCtx)}`
      : serializeAgentContext(agentCtx);

    // Concat — don't replace — so the user's preset + instructionsAppend
    // still own the bulk of the prompt.
    const dagBlock = formatParallelDownstreamBlock(parallelDownstream ?? []);
    const fullSystemPrompt = dagBlock ? `${node.instructions}\n\n${dagBlock}` : node.instructions;

    const agentRequest: AgentRequest = {
      model: node.model,
      systemPrompt: fullSystemPrompt,
      mcpServers: resolvedMcp,
      workspacePath: workspace.path,
      // Per-run scratch root — siblings + .credential-helpers/ live here.
      // Without this, Claude Code blocks any tool call that touches the
      // run dir (the workspace's parent), which contradicts the design
      // assumption noted in push-auth.ts.
      // `baseClonesRoot()` covers the bare clones that back every worktree:
      // a `.git` pointer file inside the workspace dereferences to
      // `<baseClones>/.../<repo>.git/worktrees/<name>/`, so committing or
      // pushing from the agent requires that path to be writable too.
      additionalDirectories: [runDir(runId), baseClonesRoot()],
      webSearch: node.webSearch,
      effort: node.effort,
      constraints: node.constraints ?? {},
    };

    const providerConfig = await loadProviderConfig(orgId, node.provider);
    const envApiKey = node.provider === 'claude' ? config.anthropicApiKey : config.openaiApiKey;
    const resolvedApiKey = providerConfig?.apiKey ?? envApiKey;

    const runnerRequest: RunnerRequest = {
      protocolVersion: 1,
      run: {
        runId,
        workflowId,
        workflowName,
        nodeName: node.name,
      },
      provider: {
        id: node.provider,
        anthropicApiKey: node.provider === 'claude' ? resolvedApiKey : undefined,
        openaiApiKey: node.provider === 'codex' ? resolvedApiKey : undefined,
        claudeCodeOauthToken: config.claudeCodeOauthToken,
        baseUrl: providerConfig?.baseUrl,
        extraEnv: providerConfig?.extraEnv,
      },
      agent: agentRequest,
      prompts: {
        main: mainPrompt,
        issueWriteback: writebackContext
          ? issueWritebackPrompt({
              platform: writebackContext.platform,
              owner: writebackContext.repoOwner,
              repo: writebackContext.repoName,
              issueNumber: writebackContext.issueNumber,
              allowedStatuses: writebackContext.allowedStatuses,
              allowedLabels: writebackContext.allowedLabels,
              allowedPrStates: writebackContext.allowedPrStates,
              consumedLabels: writebackContext.consumedLabels,
              isPr: writebackContext.isPr,
            })
          : undefined,
        summary: finalSummaryPrompt(node.name),
      },
    };

    const usage = { inputTokens: 0, outputTokens: 0, toolCalls: 0, turns: 0 };
    // Independent of the runner's event flow so a long-blocking tool call
    // doesn't trip Temporal's liveness check.
    const heartbeater = setInterval(() => {
      ctx.heartbeat({ nodeName: node.name, usage });
      // Keep the worktree's liveness heartbeat fresh while the agent runs so
      // a concurrent same-branch resolve sees us as alive. Fire-and-forget —
      // touchWorktreeHeartbeat never throws.
      void touchWorktreeHeartbeat(workspace.path);
    }, 30_000);

    const spawner = resolveRunnerSpawner();
    const handle = await spawner.spawn(runnerRequest, abortController.signal);
    let terminal: RunnerEvent | null = null;
    try {
      for await (const event of handle.events) {
        if (event.kind === 'agent') {
          await onAgentEvent(runId, orgId, node.name, event.event, usage);
        } else if (event.kind === 'system') {
          await Promise.all([
            publishSystemEvent(runId, node.name, event.message),
            writeSystemLog(runId, orgId, node.name, event.message),
          ]);
        } else if (event.kind === 'exit') {
          terminal = event;
          break;
        }
      }
    } finally {
      clearInterval(heartbeater);
      await handle.cancel();
    }

    if (!terminal) {
      throw new Error(`agent-runner exited without a terminal event for node "${node.name}"`);
    }
    if (!terminal.ok) {
      // Forward the runner's own stack (which points at the failing
      // turn/provider frame, e.g. codex-provider's translate) instead of
      // synthesizing one that only points here — otherwise Temporal's
      // stackTrace truncates to this rethrow and hides the real origin.
      const err = new Error(terminal.error.message);
      if (terminal.error.stack) err.stack = terminal.error.stack;
      throw err;
    }

    const output: NodeOutput = {
      files: terminal.changedFiles,
      workspacePath: workspace.path,
      head: workspace.head,
      workspaceKind: workspace.kind,
      isBranchedWorktree: workspace.isBranchedWorktree ?? false,
      branchName: workspace.branchName,
    };

    await prisma().nodeRun.update({
      where: { id: nodeRun.id },
      data: {
        status: 'COMPLETED',
        finishedAt: new Date(),
        output: output as unknown as object,
        usage: usage as unknown as object,
        workspacePath: workspace.path,
        conduitSummary: terminal.conduitSummary ?? undefined,
      },
    });

    return output;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma().nodeRun.update({
      where: { id: nodeRun.id },
      data: {
        status: ctx.cancellationSignal.aborted ? 'CANCELLED' : 'FAILED',
        error: message,
        finishedAt: new Date(),
      },
    });
    await writeSystemLog(runId, orgId, node.name, `Node ${node.name} failed: ${message}`, 'ERROR');
    throw err;
  }
}

async function onAgentEvent(
  runId: string,
  orgId: string,
  nodeName: string,
  event: AgentEvent,
  usage: { inputTokens: number; outputTokens: number; toolCalls: number; turns: number },
): Promise<void> {
  if (event.type === 'tool_call') usage.toolCalls += 1;
  if (event.type === 'usage') {
    usage.inputTokens += event.inputTokens;
    usage.outputTokens += event.outputTokens;
    usage.turns += 1;
  }
  await Promise.all([
    event.type === 'usage' ? Promise.resolve() : writeAgentEventLog(runId, orgId, nodeName, event),
    publishRunUpdate({
      runId,
      nodeName,
      event,
      ts: new Date().toISOString(),
    }),
  ]);
}

async function publishSystemEvent(runId: string, nodeName: string, message: string): Promise<void> {
  await publishRunUpdate({
    runId,
    nodeName,
    event: { type: 'system', message },
    ts: new Date().toISOString(),
  });
}

function systemMessage(
  node: AgentConfigWithWorkspace,
  workspacePath: string,
  parallelBranch?: boolean,
): string {
  const branchHint = parallelBranch ? ' · branched-worktree' : '';
  return `workspace ${node.workspace.kind}${branchHint} · ${node.provider}/${node.model} · ${workspacePath}`;
}

export async function cleanupConduitFolder(workspacePath: string): Promise<void> {
  await clearConduitFolder(workspacePath);
}

interface EntryWorkspaceInputs {
  connection?: ConnectionContext;
  ticket?: TicketContext;
  store?: TicketBranchStore;
  pr?: PrContext;
}

/**
 * Gather the per-run inputs needed by entry-kind workspace resolvers
 * (`ticket-branch` and `fixed-branch`). The connection comes from the
 * workflow's first trigger — save-time validation enforces that all
 * triggers share a connectionId.
 *
 * For `fixed-branch` (cron-driven), only the connection is populated;
 * the branch lives on the workspace spec itself, and cron carries neither
 * ticket nor PR.
 */
async function resolveEntryWorkspaceInputs(
  node: AgentConfigWithWorkspace,
  triggers: TriggerConfig[],
  triggerEvent: TriggerEvent,
): Promise<EntryWorkspaceInputs | undefined> {
  const kind = node.workspace.kind;
  if (kind !== 'ticket-branch' && kind !== 'fixed-branch') return undefined;
  const connectionId = triggers[0]?.connectionId;
  const connection = connectionId ? await loadConnectionContext(connectionId) : undefined;
  if (connectionId && !connection) {
    throw new Error(
      `${kind} workspace on node "${node.name}" references unknown connection ${connectionId}`,
    );
  }
  if (kind === 'fixed-branch') {
    return { connection };
  }
  return {
    connection,
    ticket: triggerEvent.issue
      ? { id: triggerEvent.issue.key, title: triggerEvent.issue.title }
      : undefined,
    store: makeTicketBranchStore(),
    pr: triggerEvent.pr ? { ...triggerEvent.pr } : undefined,
  };
}
