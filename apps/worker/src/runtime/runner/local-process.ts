import { spawn } from 'node:child_process';
import { runDir } from '@conduit/agent';
import type { RunnerEvent, RunnerRequest } from '@conduit/shared/runner';
import { pumpEvents, STDERR_TAIL_BYTES, TailBuffer } from './event-pump';
import {
  killProcessGroup,
  removeRunnerPidfile,
  writeRunnerPidfile,
} from './process-admin';
import type { RunnerHandle, RunnerSpawner } from './spawner';

/**
 * Host-mode implementation of `RunnerSpawner`: runs the agent-runner entry
 * point as a detached child process on the worker's own machine instead of
 * inside a Docker container. The wire protocol is identical — one
 * `RunnerRequest` on stdin, `RunnerEvent` JSON lines on stdout —
 * `apps/agent-runner/src/main.ts` runs byte-identical in both modes.
 *
 * Explicitly unsandboxed (see `mode.ts`): the agent sees the user's real
 * `$HOME`, `PATH`, and toolchains — that's the point. The trust model is
 * "agent acting as the user on their machine", same as running Claude Code
 * or Codex CLI directly. `resolveRunnerMode` makes this unreachable when
 * `CONDUIT_DEPLOYMENT=hosted`.
 *
 * No mounts, no UID mapping, no HOME override — the same-path bind-mount
 * machinery in `local-docker.ts` exists only to make the container look
 * like the host; on the host it holds by construction.
 */
export interface LocalProcessSpawnerOptions {
  /**
   * Runner entry-point script. Defaults to the `@conduit/agent-runner`
   * workspace package's `main` (`dist/main.js`); tests point it at a stub
   * runner script instead.
   */
  entryPoint?: string;
  /**
   * Liveness threshold: kill the runner if no events or heartbeats arrive
   * for this many ms. Default 60s — twice the runner's heartbeat interval.
   */
  livenessTimeoutMs?: number;
  /** How long cancel() waits after SIGTERM before escalating to SIGKILL. */
  killGraceMs?: number;
}

const DEFAULT_LIVENESS_TIMEOUT_MS = 60_000;
const DEFAULT_KILL_GRACE_MS = 5_000;

/**
 * Worker-internal secrets stripped from the runner's environment. Docker
 * mode forwards only explicit `-e` vars; a child process inherits
 * everything, so host mode subtracts instead. This keeps "the runner never
 * sees DB/KEK/other Conduit credentials" true on the host while the user's
 * toolchain env (`PATH`, `ANDROID_HOME`, `JAVA_HOME`, …) works by
 * construction. Provider credentials still travel via
 * `RunnerRequest.provider`, same as Docker mode.
 */
export const SPAWN_ENV_DENYLIST: readonly string[] = [
  'DATABASE_URL',
  'REDIS_URL',
  'CONDUIT_ENCRYPTION_KEY',
  'BETTER_AUTH_SECRET',
  'WEBHOOK_DEV_SECRET',
  'GITHUB_CLIENT_SECRET',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
];

/**
 * Pure env builder, exported for unit tests so the denylist invariants can
 * be asserted without spawning a child process (same pattern as
 * `buildDockerArgs`).
 */
export function buildSpawnEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const denied = new Set(SPAWN_ENV_DENYLIST);
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (!denied.has(key)) env[key] = value;
  }
  return env;
}

export class LocalProcessSpawner implements RunnerSpawner {
  constructor(private readonly opts: LocalProcessSpawnerOptions = {}) {}

  async spawn(req: RunnerRequest, signal: AbortSignal): Promise<RunnerHandle> {
    const livenessMs = this.opts.livenessTimeoutMs ?? DEFAULT_LIVENESS_TIMEOUT_MS;
    const killGraceMs = this.opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    const entryPoint = this.opts.entryPoint ?? resolveRunnerEntryPoint();
    const runDirPath = runDir(req.run.runId);

    // `detached` puts the runner in its own process group so cancellation
    // can signal the whole group (runner + MCP-server grandchildren) at
    // once via the negative-PID form of kill(2).
    const child = spawn(process.execPath, [entryPoint], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      env: buildSpawnEnv(process.env),
    });
    const pid = child.pid;
    if (pid === undefined) {
      throw new Error('failed to spawn agent-runner process (no pid)');
    }

    let cancelPromise: Promise<void> | null = null;
    const cancel = (): Promise<void> => {
      cancelPromise ??= killProcessGroup(pid, killGraceMs);
      return cancelPromise;
    };

    try {
      await writeRunnerPidfile(runDirPath, pid);
    } catch (err) {
      await cancel();
      throw new Error(
        `failed to write runner pidfile under ${runDirPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    child.stdin.setDefaultEncoding('utf8');
    child.stdin.write(JSON.stringify(req));
    child.stdin.end();

    // Tail buffer for stderr — only used to enrich the synthetic-exit error
    // when the runner dies before emitting an `exit` event.
    const stderrTail = new TailBuffer(STDERR_TAIL_BYTES);

    if (signal.aborted) {
      await cancel();
    } else {
      signal.addEventListener('abort', () => void cancel());
    }

    const pump = pumpEvents(child, livenessMs, cancel, stderrTail);
    const events = (async function* (): AsyncIterable<RunnerEvent> {
      try {
        yield* pump;
      } finally {
        // Pump exhausted ⇒ the runner process has exited; the pidfile is
        // no longer tracking anything. Removing it keeps the boot sweep
        // from SIGKILLing a recycled pid later.
        await removeRunnerPidfile(runDirPath).catch(() => undefined);
      }
    })();

    return { events, cancel };
  }
}

/**
 * Resolve the runner entry point through the `@conduit/agent-runner`
 * workspace dependency — its package `main` points at `dist/main.js`, so
 * resolution fails (rather than spawning a stale or missing script) when
 * the runner hasn't been built.
 */
export function resolveRunnerEntryPoint(): string {
  try {
    return require.resolve('@conduit/agent-runner');
  } catch {
    throw new Error(
      'cannot resolve @conduit/agent-runner entry point (dist/main.js) — build it first: npm run build --workspace @conduit/agent-runner',
    );
  }
}
