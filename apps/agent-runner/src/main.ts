import fs from 'node:fs/promises';
import path from 'node:path';
import { readConduitSummary, resolveProvider, git } from '@conduit/agent';
import { runnerRequestSchema, type RunnerEvent } from '@conduit/shared/runner';
import type { AgentRequest } from '@conduit/shared';
import { runAgentTurns } from './turns';

/**
 * Per-run agent execution sandbox. One process per agent node:
 *
 *   1. Read one `RunnerRequest` JSON object from stdin.
 *   2. Build the `AgentRequest` and start a provider session.
 *   3. Drive turn 1 (main work), optional turn 2a (issue writeback),
 *      and turn 2b (final summary). Forward each `AgentEvent` to stdout
 *      wrapped as `{ kind: 'agent', event }`.
 *   4. After the agent finishes: write the `.conduit/<NodeName>.md`
 *      placeholder if missing, compute `git status`, emit a terminal
 *      `exit ok` event with `head` / `changedFiles` / `conduitSummary`.
 *   5. On failure or abort: emit `exit ok=false` with the error message
 *      and exit non-zero. The orchestrator decides what to do with it.
 *
 * No DB, no Redis, no master KEK, no other connections' credentials.
 * The orchestrator hands the runner only what's needed for *this run*.
 */

const HEARTBEAT_INTERVAL_MS = 30_000;

async function main(): Promise<void> {
  const stdin = await readAllStdin();
  const parsed = runnerRequestSchema.parse(JSON.parse(stdin));
  const { run, provider, agent, prompts, timeoutMs } = parsed;

  const abort = new AbortController();
  // Self-imposed cap; orchestrator-driven cancellation is propagated by the
  // transport (stdin close + container kill) which causes process exit.
  const timeout = timeoutMs ? setTimeout(() => abort.abort(), timeoutMs) : null;

  // Heartbeats: independent of agent event flow so a slow tool call doesn't
  // look like a dead runner to the orchestrator's liveness check.
  const heartbeat = setInterval(() => emit({ kind: 'heartbeat' }), HEARTBEAT_INTERVAL_MS);

  let exitCode = 0;
  try {
    // Long-lived Claude Code OAuth token: the SDK reads
    // `CLAUDE_CODE_OAUTH_TOKEN` from env (same path the `claude` CLI uses).
    // Set it before `resolveProvider` so the SDK's lazy import picks it up.
    // The container exits at the end of this process, so this never leaks
    // beyond the run.
    if (provider.claudeCodeOauthToken) {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = provider.claudeCodeOauthToken;
    }
    if (provider.extraEnv) {
      for (const [key, value] of Object.entries(provider.extraEnv)) {
        process.env[key] = value;
      }
    }
    const adapter = resolveProvider(provider.id, {
      anthropicApiKey: provider.anthropicApiKey,
      openaiApiKey: provider.openaiApiKey,
      baseUrl: provider.baseUrl,
    });
    const agentRequest: AgentRequest = agent;
    const session = adapter.startSession(agentRequest, abort.signal);
    try {
      await runAgentTurns({ session, prompts, emit, abort });
    } finally {
      await session.dispose();
    }

    await ensureConduitSummaryPlaceholder(agent.workspacePath, run.nodeName);
    const head = await readHead(agent.workspacePath);
    const changedFiles = await listChangedFiles(agent.workspacePath);
    const conduitSummary = await readConduitSummary(agent.workspacePath, run.nodeName);
    emit({ kind: 'exit', ok: true, head, changedFiles, conduitSummary });
  } catch (err) {
    exitCode = 1;
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    emit({ kind: 'exit', ok: false, error: { message, stack } });
  } finally {
    if (timeout) clearTimeout(timeout);
    clearInterval(heartbeat);
  }

  // Make sure stdout is flushed before the process tears down — the
  // orchestrator otherwise misses the trailing exit event under load.
  await flushStdout();
  process.exit(exitCode);
}

function emit(event: RunnerEvent): void {
  process.stdout.write(JSON.stringify(event) + '\n');
}

function flushStdout(): Promise<void> {
  return new Promise((resolve) => {
    if (process.stdout.write('')) {
      resolve();
    } else {
      process.stdout.once('drain', () => resolve());
    }
  });
}

function readAllStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

async function ensureConduitSummaryPlaceholder(
  workspacePath: string,
  nodeName: string,
): Promise<void> {
  const file = path.join(workspacePath, '.conduit', `${nodeName}.md`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(
      file,
      `# ${nodeName}\n\n(Agent did not write a summary for this run.)\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
}

async function readHead(workspacePath: string): Promise<string | undefined> {
  const out = await git(['rev-parse', 'HEAD'], { cwd: workspacePath }).catch(() => '');
  return out.trim() || undefined;
}

async function listChangedFiles(workspacePath: string): Promise<string[]> {
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

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  emit({ kind: 'exit', ok: false, error: { message } });
  process.exit(1);
});
