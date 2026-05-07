import { Context } from '@temporalio/activity';
import {
  WorkspaceManager,
  baseClonesRoot,
  buildAgentContext,
  clearConduitFolder,
  discoverSkills,
  finalSummaryPrompt,
  formatParallelDownstreamBlock,
  installPushCredentials,
  installSkillsIntoWorkspace,
  issueWritebackPrompt,
  resolveMcpServers,
  runDir,
  serializeAgentContext,
} from '@conduit/agent';
import {
  findMcpPreset,
  type AgentConfig,
  type AgentConfigWithWorkspace,
  type AgentEvent,
  type AgentRequest,
  type McpServerRef,
  type NodeOutput,
  type TriggerConfig,
  type TriggerEvent,
  type WorkflowMcpServer,
} from '@conduit/shared';
import type { RunnerEvent, RunnerRequest } from '@conduit/shared/runner';
import type {
  ConnectionContext,
  PrContext,
  TicketBranchStore,
  TicketContext,
} from '@conduit/agent';
import { config } from '../config';
import { loadConnectionContext } from '../runtime/connection-context';
import { makeCredentialLookup } from '../runtime/credential-lookup';
import { publishRunUpdate } from '../runtime/event-bus';
import { writeAgentEventLog, writeSystemLog } from '../runtime/log-writer';
import { prisma } from '../runtime/prisma';
import { resolveRunnerSpawner } from '../runtime/runner';
import { makeTicketBranchStore } from '../runtime/ticket-branch-store';

export interface RunAgentNodeInput {
  workflowId: string;
  workflowName: string;
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
  } = input;
  const ctx = Context.current();
  const workspaceManager = new WorkspaceManager();

  const nodeRun = await prisma().nodeRun.upsert({
    where: { runId_nodeName: { runId, nodeName: node.name } },
    update: { status: 'RUNNING', startedAt: new Date() },
    create: {
      runId,
      nodeName: node.name,
      nodeType: 'AGENT',
      status: 'RUNNING',
      startedAt: new Date(),
    },
  });

  try {
    const ticketBranch = await resolveTicketBranchInputs(node, triggers, triggerEvent);

    const workspace = await workspaceManager.resolve({
      runId,
      nodeName: node.name,
      spec: node.workspace,
      connection: ticketBranch?.connection,
      upstreamPath: upstreamWorkspacePath,
      upstreamHead,
      parallelBranch,
      ticket: ticketBranch?.ticket,
      ticketBranchStore: ticketBranch?.store,
      pr: ticketBranch?.pr,
    });

    if (workspace.ticketBranchId) {
      await ticketBranch?.store?.markRunStart(workspace.ticketBranchId);
    }

    // Installed on the shared .git/config so inherit-chain children pick it
    // up automatically; cleanupRunActivity wipes the run dir after.
    if (workspace.kind === 'ticket-branch' && ticketBranch?.connection?.token) {
      await installPushCredentials({
        runId,
        nodeName: node.name,
        worktreePath: workspace.path,
        token: ticketBranch.connection.token,
      });
    }

    const startupMessage = systemMessage(node, workspace.path, parallelBranch);
    await Promise.all([
      publishSystemEvent(runId, node.name, startupMessage),
      writeSystemLog(runId, node.name, startupMessage),
    ]);

    const skills = node.skills.length > 0 ? await discoverSkills({ cwd: workspace.path }) : [];
    const selected = skills.filter((s) => node.skills.some((r) => r.skillId === s.id));
    if (selected.length) {
      await installSkillsIntoWorkspace(workspace.path, selected, node.provider);
    }

    // Skip auto-attach if a GitHub MCP is already referenced — the user-
    // configured one wins, regardless of which connection it uses.
    const writebackContext = resolveWritebackContext(node, triggers, triggerEvent);
    const writebackAttach =
      writebackContext && !agentReferencesGithubMcp(node, mcpServers)
        ? buildSyntheticGithubMcp(writebackContext.connectionId)
        : null;
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

    // Concat — don't replace — so the user's preset + instructionsAppend
    // still own the bulk of the prompt.
    const dagBlock = formatParallelDownstreamBlock(parallelDownstream ?? []);
    const fullSystemPrompt = dagBlock
      ? `${node.instructions}\n\n${dagBlock}`
      : node.instructions;

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
      constraints: node.constraints ?? {},
    };

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
        anthropicApiKey: config.anthropicApiKey,
        openaiApiKey: config.openaiApiKey,
        claudeCodeOauthToken: config.claudeCodeOauthToken,
      },
      agent: agentRequest,
      prompts: {
        main: serializeAgentContext(agentCtx),
        issueWriteback: writebackContext
          ? issueWritebackPrompt({
              owner: writebackContext.repoOwner,
              repo: writebackContext.repoName,
              issueNumber: writebackContext.issueNumber,
              allowedStatuses: writebackContext.allowedStatuses,
              allowedLabels: writebackContext.allowedLabels,
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
    }, 30_000);

    const spawner = resolveRunnerSpawner();
    const handle = await spawner.spawn(runnerRequest, abortController.signal);
    let terminal: RunnerEvent | null = null;
    try {
      for await (const event of handle.events) {
        if (event.kind === 'agent') {
          await onAgentEvent(runId, node.name, event.event, usage);
        } else if (event.kind === 'system') {
          await Promise.all([
            publishSystemEvent(runId, node.name, event.message),
            writeSystemLog(runId, node.name, event.message),
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
      throw new Error(terminal.error.message);
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
    await writeSystemLog(runId, node.name, `Node ${node.name} failed: ${message}`, 'ERROR');
    throw err;
  }
}

async function onAgentEvent(
  runId: string,
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
    event.type === 'usage' ? Promise.resolve() : writeAgentEventLog(runId, nodeName, event),
    publishRunUpdate({
      runId,
      nodeName,
      event,
      ts: new Date().toISOString(),
    }),
  ]);
}

async function publishSystemEvent(
  runId: string,
  nodeName: string,
  message: string,
): Promise<void> {
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

interface TicketBranchInputs {
  connection?: ConnectionContext;
  ticket?: TicketContext;
  store?: TicketBranchStore;
  pr?: PrContext;
}

/**
 * Gather the per-run inputs needed by the `ticket-branch` workspace resolver.
 * The connection comes from the workflow's first trigger — save-time
 * validation enforces that all triggers share a connectionId.
 */
async function resolveTicketBranchInputs(
  node: AgentConfigWithWorkspace,
  triggers: TriggerConfig[],
  triggerEvent: TriggerEvent,
): Promise<TicketBranchInputs | undefined> {
  if (node.workspace.kind !== 'ticket-branch') return undefined;
  const connectionId = triggers[0]?.connectionId;
  const connection = connectionId ? await loadConnectionContext(connectionId) : undefined;
  if (connectionId && !connection) {
    throw new Error(
      `ticket-branch workspace on node "${node.name}" references unknown connection ${connectionId}`,
    );
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

/** Reserved id for the auto-attached GitHub MCP server. Underscored to make
 * a collision with a user-defined server vanishingly unlikely. */
const WRITEBACK_GITHUB_MCP_ID = '__conduit_writeback_github__';

interface WritebackContext {
  connectionId: string;
  repoOwner: string;
  repoName: string;
  issueNumber: string;
  allowedStatuses: string[];
  allowedLabels: string[];
}

/**
 * Resolve the per-run writeback context. Returns undefined when the feature
 * is not configured for this agent, when the workflow has no GitHub trigger,
 * when this run wasn't fired by a GitHub issue event, or when the user
 * enabled the checkbox without picking any statuses or labels.
 */
function resolveWritebackContext(
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
  if (!triggerEvent.issue || !triggerEvent.repo) return undefined;
  const trigger = triggers.find((t) => t.platform === 'github');
  if (!trigger) return undefined;
  return {
    connectionId: trigger.connectionId,
    repoOwner: triggerEvent.repo.owner,
    repoName: triggerEvent.repo.name,
    issueNumber: triggerEvent.issue.key,
    allowedStatuses: writeback.allowedStatuses,
    allowedLabels: writeback.allowedLabels,
  };
}

/**
 * True when the agent already references a GitHub MCP server defined on the
 * workflow (matched by transport command/args, since user-defined ids are
 * arbitrary). When true, we skip auto-attach so the user-configured server
 * wins — same connection or not. Args are derived from the GitHub preset
 * so this stays correct if the underlying package ever moves.
 */
function agentReferencesGithubMcp(
  node: AgentConfig,
  mcpServers: WorkflowMcpServer[],
): boolean {
  const preset = findMcpPreset('github');
  const presetArgs =
    preset?.transport.kind === 'stdio' ? (preset.transport.args ?? []) : [];
  if (presetArgs.length === 0) return false;
  const byId = new Map(mcpServers.map((s) => [s.id, s]));
  for (const ref of node.mcpServers) {
    const def = byId.get(ref.serverId);
    if (!def) continue;
    const t = def.transport;
    if (t.kind !== 'stdio') continue;
    const args = t.args ?? [];
    if (presetArgs.some((a) => args.includes(a))) return true;
  }
  return false;
}

/** Build the synthetic GitHub MCP server entry + agent ref for auto-attach. */
function buildSyntheticGithubMcp(connectionId: string): {
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

