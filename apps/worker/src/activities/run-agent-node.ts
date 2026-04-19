import fs from 'node:fs/promises';
import path from 'node:path';
import { Context } from '@temporalio/activity';
import {
  WorkspaceManager,
  buildAgentContext,
  clearConduitFolder,
  discoverSkills,
  finalSummaryPrompt,
  git,
  installPushCredentials,
  installSkillsIntoWorkspace,
  readConduitSummary,
  resolveMcpServers,
  resolveProvider,
  serializeAgentContext,
} from '@conduit/agent';
import type {
  AgentConfig,
  AgentEvent,
  NodeOutput,
  TriggerEvent,
  WorkflowMcpServer,
} from '@conduit/shared';
import { config } from '../config';
import { loadConnectionContext } from '../runtime/connection-context';
import { makeCredentialLookup } from '../runtime/credential-lookup';
import { publishRunUpdate } from '../runtime/event-bus';
import { writeAgentEventLog, writeSystemLog } from '../runtime/log-writer';
import { prisma } from '../runtime/prisma';
import { makeTicketBranchStore } from '../runtime/ticket-branch-store';

export interface RunAgentNodeInput {
  workflowId: string;
  workflowName: string;
  runId: string;
  node: AgentConfig;
  mcpServers: WorkflowMcpServer[];
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
}

/**
 * The workhorse activity. One invocation per agent node. Orchestrates:
 *   1. Create `NodeRun` row, flip to RUNNING.
 *   2. Resolve workspace (repo-clone / inherit / fresh-tmpdir). Parallel
 *      `inherit` siblings get a branched worktree so they don't stomp.
 *   3. Copy selected skills into the workspace.
 *   4. Resolve MCP configs (credentials substituted in-memory).
 *   5. Start a provider session; drive turn 1 (`AgentContext`) and turn 2
 *      (write `.conduit/<NodeName>.md` summary) through the same session
 *      so the agent keeps conversation state across the summary step.
 *   6. Capture workspace path + head + `.conduit/` summary for downstream.
 *   7. On error/cancel: flip `NodeRun` to FAILED/CANCELLED, propagate.
 *
 * The activity is idempotent up to the workspace step — Temporal retries
 * re-enter from the top. Real agent runs are not resumable mid-session.
 */
export async function runAgentNode(input: RunAgentNodeInput): Promise<NodeOutput> {
  const {
    runId,
    node,
    workflowId,
    workflowName,
    mcpServers,
    triggerEvent,
    upstreamWorkspacePath,
    upstreamHead,
    parallelBranch,
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
    const connectionId =
      node.workspace.kind === 'repo-clone' || node.workspace.kind === 'ticket-branch'
        ? node.workspace.connectionId
        : undefined;
    const connection = connectionId
      ? await loadConnectionContext(connectionId)
      : undefined;
    if (connectionId && !connection) {
      throw new Error(
        `${node.workspace.kind} workspace on node "${node.name}" references unknown connection ${connectionId}`,
      );
    }

    const ticket =
      node.workspace.kind === 'ticket-branch' && triggerEvent.issue
        ? { id: triggerEvent.issue.key, title: triggerEvent.issue.title }
        : undefined;
    const ticketBranchStore =
      node.workspace.kind === 'ticket-branch' ? makeTicketBranchStore() : undefined;

    const workspace = await workspaceManager.resolve({
      runId,
      nodeName: node.name,
      spec: node.workspace,
      connection,
      upstreamPath: upstreamWorkspacePath,
      upstreamHead,
      parallelBranch,
      ticket,
      ticketBranchStore,
    });

    if (workspace.ticketBranchId) {
      await ticketBranchStore?.markRunStart(workspace.ticketBranchId);
    }

    // Installed on the shared .git/config so inherit-chain children pick it
    // up automatically; cleanupRunActivity wipes the run dir after.
    if (workspace.kind === 'ticket-branch' && connection?.token) {
      await installPushCredentials({
        runId,
        nodeName: node.name,
        worktreePath: workspace.path,
        token: connection.token,
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

    const resolvedMcp = await resolveMcpServers(node, mcpServers, makeCredentialLookup());

    const provider = resolveProvider(node.provider, {
      anthropicApiKey: config.anthropicApiKey,
    });

    const abortController = new AbortController();
    ctx.cancellationSignal.addEventListener('abort', () => abortController.abort());

    const agentCtx = buildAgentContext({
      trigger: triggerEvent,
      workflow: { id: workflowId, name: workflowName },
      run: { id: runId, startedAt: nodeRun.startedAt ?? new Date() },
    });

    const usage = { inputTokens: 0, outputTokens: 0, toolCalls: 0, turns: 0 };
    const session = provider.startSession(
      {
        model: node.model,
        systemPrompt: node.instructions,
        mcpServers: resolvedMcp,
        workspacePath: workspace.path,
        constraints: node.constraints ?? {},
      },
      abortController.signal,
    );

    try {
      // Turn 1 — main work. The agent reads upstream `.conduit/*.md` on its
      // own via file tools; only the trigger/workflow/run shell is injected.
      for await (const event of session.run(serializeAgentContext(agentCtx))) {
        await onAgentEvent(runId, node.name, event, usage);
        ctx.heartbeat({ nodeName: node.name, usage, phase: 'main' });
      }

      // Turn 2 — final summary. Same session, so conversation state is
      // retained. The agent is expected to write `.conduit/<NodeName>.md`.
      for await (const event of session.run(finalSummaryPrompt(node.name))) {
        await onAgentEvent(runId, node.name, event, usage);
        ctx.heartbeat({ nodeName: node.name, usage, phase: 'summary' });
      }
    } finally {
      await session.dispose();
    }

    await ensureConduitSummaryPlaceholder(workspace.path, node);
    const conduitSummary = await readConduitSummary(workspace.path, node.name);
    const files = await listChangedFiles(workspace.path);

    const output: NodeOutput = {
      files,
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
        conduitSummary: conduitSummary ?? undefined,
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
    writeAgentEventLog(runId, nodeName, event),
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

function systemMessage(node: AgentConfig, workspacePath: string, parallelBranch?: boolean): string {
  const branchHint = parallelBranch ? ' · branched-worktree' : '';
  return `workspace ${node.workspace.kind}${branchHint} · ${node.provider}/${node.model} · ${workspacePath}`;
}

/**
 * Write a minimal `.conduit/<NodeName>.md` placeholder if the agent didn't
 * produce one during the summary turn. The workflow/UI always expect a file
 * to exist; downstream agents fall back to the placeholder gracefully.
 */
async function ensureConduitSummaryPlaceholder(
  workspacePath: string,
  node: AgentConfig,
): Promise<void> {
  const file = path.join(workspacePath, '.conduit', `${node.name}.md`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(
      file,
      `# ${node.name}\n\n(Agent did not write a summary for this run.)\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    // Agent already wrote a summary — leave it intact.
  }
}

/**
 * Compare the workspace against its baseline commit. Returns an empty list
 * if the workspace isn't a git repo (fresh-tmpdir).
 */
async function listChangedFiles(workspacePath: string): Promise<string[]> {
  // `--untracked-files=all` recurses into untracked directories — the default
  // `-unormal` collapses a fresh dir into its top-level path, which is useless
  // for the "changed files" view.
  const stdout = await git(['status', '--porcelain', '--untracked-files=all'], {
    cwd: workspacePath,
  }).catch(() => '');
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .filter((file) => file !== '.conduit' && !file.startsWith('.conduit/'));
}

export async function cleanupConduitFolder(workspacePath: string): Promise<void> {
  await clearConduitFolder(workspacePath);
}
