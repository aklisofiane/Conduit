import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { Context } from '@temporalio/activity';
import {
  WorkspaceManager,
  buildAgentContext,
  clearConduitFolder,
  discoverSkills,
  installSkillsIntoWorkspace,
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

export interface RunAgentNodeInput {
  workflowId: string;
  workflowName: string;
  runId: string;
  node: AgentConfig;
  mcpServers: WorkflowMcpServer[];
  triggerEvent: TriggerEvent;
  /** Populated when the node has a `workspace.inherit.fromNode`. */
  upstreamWorkspacePath?: string;
}

/**
 * The workhorse activity. One invocation per agent node. Orchestrates:
 *   1. Create `NodeRun` row, flip to RUNNING.
 *   2. Resolve workspace (repo-clone / inherit / fresh-tmpdir).
 *   3. Copy selected skills into the workspace.
 *   4. Resolve MCP configs (credentials substituted in-memory).
 *   5. Stream provider events → Redis (live UI) + ExecutionLog (replay) +
 *      Temporal heartbeats.
 *   6. Capture workspace path + .conduit/ summary for downstream nodes.
 *   7. On error/cancel: flip `NodeRun` to FAILED/CANCELLED, propagate.
 *
 * The activity is idempotent up to the workspace step — Temporal retries
 * re-enter from the top. Real agent runs are not resumable mid-session.
 */
export async function runAgentNode(input: RunAgentNodeInput): Promise<NodeOutput> {
  const { runId, node, workflowId, workflowName, mcpServers, triggerEvent } = input;
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
    const connection =
      node.workspace.kind === 'repo-clone'
        ? await loadConnectionContext(node.workspace.connectionId)
        : undefined;
    if (node.workspace.kind === 'repo-clone' && !connection) {
      throw new Error(
        `repo-clone workspace on node "${node.name}" references unknown connection ${node.workspace.connectionId}`,
      );
    }

    const workspace = await workspaceManager.resolve({
      runId,
      nodeName: node.name,
      spec: node.workspace,
      connection,
      upstreamPath: input.upstreamWorkspacePath,
    });

    const startupMessage = systemMessage(node, workspace.path);
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

    const stream = provider.execute(
      {
        model: node.model,
        systemPrompt: node.instructions,
        userMessage: serializeAgentContext(agentCtx),
        mcpServers: resolvedMcp,
        workspacePath: workspace.path,
        constraints: node.constraints ?? {},
      },
      abortController.signal,
    );

    const usage = { inputTokens: 0, outputTokens: 0, toolCalls: 0, turns: 0 };
    for await (const event of stream) {
      await onAgentEvent(runId, node.name, event, usage);
      ctx.heartbeat({ nodeName: node.name, usage });
    }

    await writeConduitSummary(workspace.path, node);
    const files = await listChangedFiles(workspace.path);

    await prisma().nodeRun.update({
      where: { id: nodeRun.id },
      data: {
        status: 'COMPLETED',
        finishedAt: new Date(),
        output: { files, workspacePath: workspace.path } as unknown as object,
        usage: usage as unknown as object,
        workspacePath: workspace.path,
      },
    });

    return { files, workspacePath: workspace.path };
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

function systemMessage(node: AgentConfig, workspacePath: string): string {
  return `workspace ${node.workspace.kind} · ${node.provider}/${node.model} · ${workspacePath}`;
}

const execFileAsync = promisify(execFile);

/**
 * Write a minimal `.conduit/<NodeName>.md` placeholder so downstream agents
 * always see a file — even if the agent forgot to write one. Agents are
 * expected to overwrite this during their run.
 */
async function writeConduitSummary(workspacePath: string, node: AgentConfig): Promise<void> {
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
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: workspacePath });
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Exposed so the workflow can call it directly when a node errors out. */
export async function cleanupConduitFolder(workspacePath: string): Promise<void> {
  await clearConduitFolder(workspacePath);
}
