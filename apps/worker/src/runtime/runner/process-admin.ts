import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runsRoot } from '@conduit/agent';
import { prisma } from '../prisma';

/**
 * Host-mode counterpart of `docker-admin.ts`. Docker tracks runner
 * containers via the `conduit.runId` label; host mode tracks runner
 * process groups via a `<runDir>/runner.pid` file written at spawn and
 * removed when the event stream ends. A worker crash leaves the pidfile
 * behind, and the boot-time sweep reaps it.
 */
const PIDFILE_NAME = 'runner.pid';

export function runnerPidfilePath(runDirPath: string): string {
  return path.join(runDirPath, PIDFILE_NAME);
}

export async function writeRunnerPidfile(runDirPath: string, pid: number): Promise<void> {
  await fs.writeFile(runnerPidfilePath(runDirPath), `${pid}\n`, 'utf8');
}

export async function removeRunnerPidfile(runDirPath: string): Promise<void> {
  await fs.rm(runnerPidfilePath(runDirPath), { force: true });
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
 * any `runner.pid` under the runs root whose run is in a terminal state
 * (or no longer exists in the DB) gets its process group SIGKILLed and the
 * pidfile removed. Catches runners left behind when the worker exited
 * mid-run — Temporal restarts the activity from the top, so the old
 * process should never linger.
 *
 * Best-effort: an unreadable pidfile, a DB error, or an unsignalable group
 * never fails startup. A stale pidfile whose pid the OS has recycled can
 * in principle kill an unrelated process group; pidfiles are removed when
 * runs end normally, so this only risks pids from a worker crash, swept on
 * the very next boot.
 */
export async function sweepOrphanProcessGroups(): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(runsRoot(), { withFileTypes: true });
  } catch {
    return; // no runs root yet — nothing to sweep
  }

  const candidates: Array<{ runId: string; pid: number; runDirPath: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runDirPath = path.join(runsRoot(), entry.name);
    const raw = await fs.readFile(runnerPidfilePath(runDirPath), 'utf8').catch(() => null);
    if (raw === null) continue;
    const pid = Number.parseInt(raw.trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0) {
      await removeRunnerPidfile(runDirPath).catch(() => undefined);
      continue;
    }
    candidates.push({ runId: entry.name, pid, runDirPath });
  }
  if (candidates.length === 0) return;

  const rows = await prisma()
    .workflowRun.findMany({
      where: { id: { in: candidates.map((c) => c.runId) } },
      select: { id: true, status: true },
    })
    .catch(() => [] as Array<{ id: string; status: string }>);
  const statusByRun = new Map(rows.map((r) => [r.id, r.status]));

  for (const c of candidates) {
    const status = statusByRun.get(c.runId);
    const orphaned =
      status === 'COMPLETED' ||
      status === 'FAILED' ||
      status === 'CANCELLED' ||
      status === undefined;
    if (!orphaned) continue;
    signalProcessGroup(c.pid, 'SIGKILL');
    await removeRunnerPidfile(c.runDirPath).catch(() => undefined);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
