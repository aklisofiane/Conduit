import { execFile } from 'node:child_process';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { runDir, runsRoot } from '@conduit/agent';
import { findOrphanedRunIds } from './orphans';

const execFileP = promisify(execFile);

/**
 * Host-mode counterpart of `docker-admin.ts`. Docker tracks runner
 * containers via the `conduit.runId` label; host mode tracks runner
 * process groups via a `<runDir>/runner-<nodeName>.pid` file written at
 * spawn and removed once the group is confirmed dead. A worker crash
 * leaves the pidfile behind, and the boot-time sweep reaps it.
 *
 * One pidfile per node, not per run: parallel nodes in the same run share
 * a runId (and a run dir), and a single `runner.pid` would let sibling
 * spawns clobber each other's tracking — mirroring Docker mode's
 * `conduit-runner-<runId>-<nodeName>` container names.
 *
 * The pidfile stores the process start time alongside the pid so the
 * sweep can tell "our runner" from "an unrelated process that inherited a
 * recycled pid" (e.g. after a machine reboot) before SIGKILLing the group.
 */
const PIDFILE_PATTERN = /^runner(-[a-zA-Z0-9_.-]*)?\.pid$/;

interface PidfileContents {
  pid: number;
  /** `ps -o lstart=` at spawn time; null when it couldn't be captured. */
  startedAt: string | null;
}

export function runnerPidfilePath(runDirPath: string, nodeName: string): string {
  // Node names are already restricted by `nodeNameSchema`; sanitize
  // defensively, same as `makeContainerName` in local-docker.ts.
  const safeNode = nodeName.replace(/[^a-zA-Z0-9_.-]/g, '-');
  return path.join(runDirPath, `runner-${safeNode}.pid`);
}

export async function writeRunnerPidfile(
  runDirPath: string,
  nodeName: string,
  pid: number,
): Promise<void> {
  const contents: PidfileContents = { pid, startedAt: await processStartTime(pid) };
  await fs.writeFile(runnerPidfilePath(runDirPath, nodeName), JSON.stringify(contents), 'utf8');
}

export async function removeRunnerPidfile(runDirPath: string, nodeName: string): Promise<void> {
  await fs.rm(runnerPidfilePath(runDirPath, nodeName), { force: true });
}

/**
 * Start time of a process per `ps -o lstart=` — stable for the process's
 * lifetime and second-granular, which is enough to disambiguate a recycled
 * pid. Returns null when `ps` fails or the process is gone; callers treat
 * null as "nothing to verify against".
 */
async function processStartTime(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileP('ps', ['-o', 'lstart=', '-p', String(pid)]);
    const line = stdout.trim();
    return line === '' ? null : line;
  } catch {
    return null;
  }
}

/**
 * True when the pid still names the process the pidfile was written for.
 * A null answer from `ps` does NOT mean the group is gone: the leader can
 * exit while grandchildren keep the group alive — and a pid is never
 * recycled while it still names a live process group, so in that case the
 * group can only be ours and killing is safe.
 */
async function pidIdentityMatches(stored: PidfileContents): Promise<boolean> {
  if (stored.startedAt === null) return true;
  const current = await processStartTime(stored.pid);
  if (current === null) return true;
  return current === stored.startedAt;
}

/**
 * Signal an entire process group (negative-PID form of `kill(2)`), so the
 * runner's grandchildren — MCP servers, provider-spawned tools — die with
 * it. The runner is spawned `detached`, making it the leader of its own
 * group; its pid doubles as the group id.
 *
 * Returns false when the group no longer exists (`ESRCH`) — idempotent by
 * construction. Other errors (e.g. `EPERM`) also resolve to "couldn't
 * signal"; killing is always best-effort.
 */
export function signalProcessGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

function processGroupAlive(pid: number): boolean {
  return signalProcessGroup(pid, 0);
}

const POLL_INTERVAL_MS = 100;

/**
 * SIGTERM the group, escalate to SIGKILL after `graceMs` if it's still
 * alive, and resolve only when the group is gone — preserving the
 * orchestrator's sequencing contract (cancel() returns ⇒ runner torn down).
 * The post-SIGKILL wait is capped at another `graceMs` so a process stuck
 * in uninterruptible kernel sleep can't wedge the cancel path forever.
 */
export async function killProcessGroup(pid: number, graceMs: number): Promise<void> {
  if (!signalProcessGroup(pid, 'SIGTERM')) return;
  if (!processGroupAlive(pid)) return;
  const termDeadline = Date.now() + graceMs;
  while (Date.now() < termDeadline) {
    await sleep(POLL_INTERVAL_MS);
    if (!processGroupAlive(pid)) return;
  }
  signalProcessGroup(pid, 'SIGKILL');
  const killDeadline = Date.now() + graceMs;
  while (processGroupAlive(pid) && Date.now() < killDeadline) {
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Orphan sweep on startup, mirroring `sweepOrphans` in `docker-admin.ts`:
 * any runner pidfile under the runs root whose run is in a terminal state
 * (or no longer exists in the DB) gets its process group SIGKILLed and the
 * pidfile removed. Catches runners left behind when the worker exited
 * mid-run — Temporal does not retry `runAgentNode`, so the old process
 * should never linger.
 *
 * Best-effort, with two safety properties: a DB error skips the sweep
 * entirely (it must not make live runners look orphaned), and the stored
 * process start time is checked before signalling so a recycled pid —
 * e.g. after a machine reboot — is never SIGKILLed.
 */
export async function sweepOrphanProcessGroups(): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(runsRoot(), { withFileTypes: true });
  } catch {
    return; // no runs root yet — nothing to sweep
  }

  const candidates: Array<{ runId: string; pidfilePath: string; stored: PidfileContents }> = [];
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const runDirPath = runDir(entry.name);
        const files = await fs.readdir(runDirPath).catch(() => [] as string[]);
        for (const file of files) {
          if (!PIDFILE_PATTERN.test(file)) continue;
          const pidfilePath = path.join(runDirPath, file);
          const stored = await readPidfile(pidfilePath);
          if (stored === null) {
            await fs.rm(pidfilePath, { force: true }).catch(() => undefined);
            continue;
          }
          candidates.push({ runId: entry.name, pidfilePath, stored });
        }
      }),
  );
  if (candidates.length === 0) return;

  const orphanedRunIds = await findOrphanedRunIds([...new Set(candidates.map((c) => c.runId))]);
  if (orphanedRunIds === null) return; // DB unreachable — retry on the next boot

  for (const c of candidates) {
    if (!orphanedRunIds.has(c.runId)) continue;
    if (await pidIdentityMatches(c.stored)) {
      signalProcessGroup(c.stored.pid, 'SIGKILL');
    }
    await fs.rm(c.pidfilePath, { force: true }).catch(() => undefined);
  }
}

async function readPidfile(pidfilePath: string): Promise<PidfileContents | null> {
  const raw = await fs.readFile(pidfilePath, 'utf8').catch(() => null);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { pid, startedAt } = parsed as Record<string, unknown>;
    if (!Number.isInteger(pid) || (pid as number) <= 0) return null;
    return { pid: pid as number, startedAt: typeof startedAt === 'string' ? startedAt : null };
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
