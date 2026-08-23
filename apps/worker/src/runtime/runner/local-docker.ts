import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bareCloneOf, runDir } from '@conduit/agent';
import type { RunnerRequest } from '@conduit/shared/runner';
import { resolveAgentAuthMode, type AgentAuthMode } from './auth-mode';
import { pumpEvents, STDERR_TAIL_BYTES, TailBuffer } from './event-pump';
import { sanitizeNameSegment } from './names';
import type { RunnerHandle, RunnerSpawner } from './spawner';

export type { AgentAuthMode };

/**
 * Writable HOME baked into the runner image (see `apps/agent-runner/Dockerfile`).
 * Codex (and other CLIs the agent reaches for) write to `$HOME` at startup
 * — RC files for PATH updates, `~/.codex/` for session/log state — and abort
 * if it isn't writable. Same path inside every runner container.
 */
const HOME_IN_CONTAINER = '/home/runner';

/**
 * Phase-1 implementation of `RunnerSpawner`. Shells out to `docker run --rm`
 * with bind mounts wired so the agent inside the container reads/writes the
 * exact host paths the orchestrator already resolved.
 *
 * Hard invariants — not user-configurable:
 *   - run dir mounted at the same absolute path inside the container
 *     (anything else breaks `.git` pointer files in worktrees)
 *   - bare clone (when applicable) mounted at the same absolute path —
 *     and *only* the one bare clone backing this workspace, never the whole
 *     `~/.conduit/base-clones/` tree
 *   - container UID = host worker UID (never root)
 *   - default bridge networking (no `--privileged`, no docker.sock,
 *     no `--network=host`)
 *   - all capabilities dropped, `no-new-privileges` set (no setuid
 *     re-escalation), pids capped (no fork bombs)
 *
 * No env-var or caller-supplied option can widen the mount surface, change
 * the network mode, or restore capabilities. Memory/CPU ceilings are the
 * only operator-tunable knobs (`CONDUIT_RUNNER_MEMORY` /
 * `CONDUIT_RUNNER_CPUS`) — tunable in size, not removable.
 */
export interface LocalDockerSpawnerOptions {
  /** Image tag to run, e.g. `agent-runner:dev` or `agent-runner:<git-sha>`. */
  image: string;
  /**
   * Liveness threshold: kill the container if no events or heartbeats arrive
   * for this many ms. Default 60s — twice the runner's heartbeat interval.
   */
  livenessTimeoutMs?: number;
}

const DEFAULT_LIVENESS_TIMEOUT_MS = 60_000;

/**
 * Process-count ceiling for the container. Generous for real work — npm
 * installs, native builds, and provider CLIs fan out dozens of processes,
 * not hundreds — while making a fork bomb die inside the container instead
 * of taking down the host. Deliberately not env-tunable: an operator who
 * needs >512 concurrent pids in one agent run has a different problem.
 */
const PIDS_LIMIT = 512;

const DEFAULT_MEMORY = '4g';
const DEFAULT_CPUS = '2';

export interface RunnerResourceLimits {
  /** Docker `--memory` value, e.g. `4g`. */
  memory: string;
  /** Docker `--cpus` value, e.g. `2`. */
  cpus: string;
}

/**
 * Memory/CPU ceilings for the runner container. Defaults are sized for a
 * typical agent run (deps install + native build headroom); operators with
 * heavier workloads raise them via env. Exported for unit tests.
 */
export function resolveResourceLimits(env: NodeJS.ProcessEnv = process.env): RunnerResourceLimits {
  return {
    memory: env.CONDUIT_RUNNER_MEMORY?.trim() || DEFAULT_MEMORY,
    cpus: env.CONDUIT_RUNNER_CPUS?.trim() || DEFAULT_CPUS,
  };
}

export class LocalDockerSpawner implements RunnerSpawner {
  constructor(private readonly opts: LocalDockerSpawnerOptions) {}

  async spawn(req: RunnerRequest, signal: AbortSignal): Promise<RunnerHandle> {
    const livenessMs = this.opts.livenessTimeoutMs ?? DEFAULT_LIVENESS_TIMEOUT_MS;
    const runDirPath = runDir(req.run.runId);
    const bareClone = await bareCloneOf(req.agent.workspacePath);
    const uid = os.userInfo().uid;
    const gid = os.userInfo().gid;
    const containerName = makeContainerName(req.run.runId, req.run.nodeName);
    const authMode = resolveAgentAuthMode();
    const authMounts = authMode === 'oauth-mount' ? await resolveOauthMounts() : [];
    const testMounts = resolveTestMounts();
    const args = buildDockerArgs({
      image: this.opts.image,
      containerName,
      runId: req.run.runId,
      nodeName: req.run.nodeName,
      runDirPath,
      bareClone,
      uid,
      gid,
      authMounts,
      testMounts,
      // Test-mode env passthrough is gated on `testMounts` being non-empty
      // — the same signal that says "this run has the trust boundary
      // widened on purpose." Forwards just the StubProvider selection so
      // the e2e harness can drive scripted runs against the real image
      // without a protocol-level test field.
      forwardedEnv: testMounts.length > 0 ? testModeForwardedEnv() : {},
      limits: resolveResourceLimits(),
    });

    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    // Swallow EPIPE from a docker process that dies before draining stdin —
    // an unhandled stream 'error' would crash the whole worker. The failure
    // still surfaces through the pump's synthetic exit event.
    child.stdin.on('error', () => undefined);
    child.stdin.setDefaultEncoding('utf8');
    child.stdin.write(JSON.stringify(req));
    child.stdin.end();

    // Tail buffer for stderr — only used to enrich the synthetic-exit error
    // when the runner dies before emitting an `exit` event. A chatty agent
    // can stream a lot of stderr; capping keeps memory bounded.
    const stderrTail = new TailBuffer(STDERR_TAIL_BYTES);

    let cancelPromise: Promise<void> | null = null;
    const cancel = (): Promise<void> => {
      // `docker kill` is idempotent — no-op if the container has already
      // exited. We use it (not `child.kill`) so the container is removed
      // before we return; otherwise the next run with the same name races.
      cancelPromise ??= new Promise<void>((resolve) => {
        const k = spawn('docker', ['kill', containerName], { stdio: 'ignore' });
        k.on('exit', () => resolve());
        k.on('error', () => resolve());
      });
      return cancelPromise;
    };

    if (signal.aborted) {
      await cancel();
    } else {
      signal.addEventListener('abort', () => void cancel());
    }

    const events = pumpEvents(child, livenessMs, cancel, stderrTail);

    return { events, cancel };
  }
}

export interface BuildArgsInput {
  image: string;
  containerName: string;
  runId: string;
  nodeName: string;
  runDirPath: string;
  bareClone: string | null;
  uid: number;
  gid: number;
  /**
   * Read-write bind mounts for OAuth credential files when
   * `CONDUIT_AGENT_AUTH=oauth-mount`. The source is a host path; the target
   * is rewritten under the in-container HOME (`/home/runner/.codex/...`)
   * so the SDK finds it via `os.homedir()` while host paths stay private to
   * the host. Empty under `api-key` mode.
   */
  authMounts: AuthMount[];
  /**
   * Test-only same-path mounts driven by `CONDUIT_RUNNER_TEST_MOUNTS`. The
   * e2e harness uses this to make per-test scaffolding (test remote bare
   * repos, seed working clones, stub script file location) visible inside
   * the runner. Empty in production. The variable must never be set in any
   * shared environment — it widens the trust boundary by definition.
   */
  testMounts: string[];
  /**
   * Test-only env vars forwarded into the container as `-e KEY=VALUE`. Gated
   * on `testMounts` being non-empty in `LocalDockerSpawner.spawn` — same
   * "test mode is on" signal. Empty in production runs.
   */
  forwardedEnv: Record<string, string>;
  /** Memory/CPU ceilings — see `resolveResourceLimits`. */
  limits: RunnerResourceLimits;
}

export interface AuthMount {
  /** Host path; bind-mount source. */
  source: string;
  /** Path inside the container; bind-mount target. Must live under `HOME_IN_CONTAINER`. */
  target: string;
}

/**
 * Pure docker-argv builder, exported for unit tests so the security-
 * critical invariants from `.specs/docker-runner.md` (same-path mounts,
 * non-root UID, no `--privileged`, no host networking, no docker.sock)
 * can be asserted without spawning a child process.
 */
export function buildDockerArgs(input: BuildArgsInput): string[] {
  const args: string[] = [
    'run',
    '--rm',
    '-i',
    '--name',
    input.containerName,
    '--user',
    `${input.uid}:${input.gid}`,
    // Hardening — same non-configurable tier as the mount/network
    // invariants: the container exists to run untrusted agent code. The UID
    // is already non-root; dropping the capability bounding set and blocking
    // setuid re-escalation closes the "root-owned setuid binary in the
    // image" path, and the pids cap contains fork bombs.
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    String(PIDS_LIMIT),
    // Resource ceilings so a runaway agent degrades its own run, not the
    // host (and not sibling runs).
    '--memory',
    input.limits.memory,
    '--cpus',
    input.limits.cpus,
    '--label',
    `conduit.runId=${input.runId}`,
    '--label',
    `conduit.nodeName=${input.nodeName}`,
    // Same-path bind mount so absolute paths on the host (workspace path,
    // git worktree pointers) resolve identically inside the container.
    '-v',
    `${input.runDirPath}:${input.runDirPath}:rw`,
  ];
  if (input.bareClone) {
    args.push('-v', `${input.bareClone}:${input.bareClone}:rw`);
  }
  for (const m of input.authMounts) {
    args.push('-v', `${m.source}:${m.target}:rw`);
  }
  for (const p of input.testMounts) {
    args.push('-v', `${p}:${p}:rw`);
  }
  // Pinned at the call site so the image's `ENV HOME` can change without
  // silently breaking codex's `~/.codex/` writes.
  args.push('-e', `HOME=${HOME_IN_CONTAINER}`);
  for (const [k, v] of Object.entries(input.forwardedEnv)) {
    args.push('-e', `${k}=${v}`);
  }
  args.push(input.image);
  return args;
}

/**
 * Read `CONDUIT_RUNNER_TEST_MOUNTS` — a colon-delimited list of host paths
 * that the e2e harness needs visible inside the runner (test remotes, seed
 * roots, etc.). Each path is bind-mounted at the same absolute path. Empty
 * unless the env var is set; production never sets it.
 */
function resolveTestMounts(): string[] {
  const v = process.env.CONDUIT_RUNNER_TEST_MOUNTS;
  if (!v) return [];
  return v
    .split(':')
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Env vars the e2e harness needs inside the runner once the stub-script
 * file is reachable via test mounts. Hardcoded allowlist — only
 * `StubProvider`-related signals — so this never accidentally forwards
 * something larger (DB URLs, the master KEK, etc.).
 */
function testModeForwardedEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  const allow = ['CONDUIT_PROVIDER', 'CONDUIT_STUB_SCRIPT'];
  for (const key of allow) {
    const value = process.env[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Codex-only — Claude has a clean env-var path (`CLAUDE_CODE_OAUTH_TOKEN`
 * from `claude setup-token`) which is plumbed through `RunnerRequest`,
 * not via a bind mount. Codex doesn't (yet) expose an equivalent token,
 * so its OAuth flow still requires its on-disk `auth.json`.
 *
 * Returns `~/.codex/auth.json` (host) mapped to `/home/runner/.codex/auth.json`
 * (container) if the host file exists, else nothing. Skipping a missing
 * file means a user who hasn't logged into Codex can still run Claude;
 * the SDK will 401 if Codex is then invoked, which is the same failure
 * mode as the api-key path.
 */
async function resolveOauthMounts(): Promise<AuthMount[]> {
  const codexAuth = path.join(os.homedir(), '.codex', 'auth.json');
  try {
    await fs.stat(codexAuth);
    return [{ source: codexAuth, target: path.join(HOME_IN_CONTAINER, '.codex', 'auth.json') }];
  } catch {
    return [];
  }
}

function makeContainerName(runId: string, nodeName: string): string {
  // Docker container names accept [a-zA-Z0-9_.-]; sanitize both segments.
  return `conduit-runner-${sanitizeNameSegment(runId)}-${sanitizeNameSegment(nodeName)}`.slice(
    0,
    200,
  );
}
