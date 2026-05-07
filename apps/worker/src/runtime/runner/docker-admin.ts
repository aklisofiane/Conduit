import { spawn } from 'node:child_process';
import { prisma } from '../prisma';

/**
 * Docker is a hard requirement in phase 1 — the worker has no inproc
 * fallback. Run a quick `docker ps` at startup and fail fast if Docker
 * isn't reachable, with a message clear enough that a fresh checkout
 * doesn't end up debugging Temporal task-queue silence.
 */
export async function dockerPreflight(): Promise<void> {
  const result = await runCommand('docker', ['ps', '--quiet']);
  if (result.code === 0) return;
  const detail = result.stderr.trim() || `exited with code ${result.code}`;
  throw new Error(
    `Worker requires Docker to spawn agent-runner containers. \`docker ps\` failed: ${detail}. ` +
      `Start Docker (or the WSL backend) and retry, or install via https://docs.docker.com/engine/install/.`,
  );
}

/**
 * Orphan sweep on startup. Any container labelled `conduit.runId=<id>` whose
 * run is in a terminal state (or no longer exists in the DB) gets killed.
 * Catches the case where the worker exited mid-run before its child
 * containers — Temporal restarts the activity from the top, so the old
 * container should never linger.
 *
 * Best-effort: a docker error or a missing run row never fails startup.
 */
export async function sweepOrphans(): Promise<void> {
  const ids = await listConduitContainers();
  if (ids.length === 0) return;

  const inspections = await Promise.all(ids.map(inspectContainer));
  const live = inspections.filter((i): i is ContainerInfo => i !== null);

  const runIds = [...new Set(live.map((c) => c.runId))];
  const rows = await prisma()
    .workflowRun.findMany({
      where: { id: { in: runIds } },
      select: { id: true, status: true },
    })
    .catch(() => [] as Array<{ id: string; status: string }>);
  const statusByRun = new Map(rows.map((r) => [r.id, r.status]));

  for (const c of live) {
    const status = statusByRun.get(c.runId);
    const isOrphan =
      status === 'COMPLETED' ||
      status === 'FAILED' ||
      status === 'CANCELLED' ||
      status === undefined;
    if (!isOrphan) continue;
    await runCommand('docker', ['kill', c.id]).catch(() => undefined);
  }
}

interface ContainerInfo {
  id: string;
  runId: string;
}

async function listConduitContainers(): Promise<string[]> {
  const result = await runCommand('docker', [
    'ps',
    '--filter',
    'label=conduit.runId',
    '--format',
    '{{.ID}}',
  ]);
  if (result.code !== 0) return [];
  return result.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

async function inspectContainer(id: string): Promise<ContainerInfo | null> {
  const result = await runCommand('docker', [
    'inspect',
    '--format',
    '{{ index .Config.Labels "conduit.runId" }}',
    id,
  ]);
  if (result.code !== 0) return null;
  const runId = result.stdout.trim();
  if (!runId) return null;
  return { id, runId };
}

interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCommand(cmd: string, args: string[]): Promise<CmdResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on('data', (c: Buffer) => stdout.push(c));
    child.stderr?.on('data', (c: Buffer) => stderr.push(c));
    child.on('error', (err) => {
      resolve({
        code: -1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: err instanceof Error ? err.message : String(err),
      });
    });
    child.on('exit', (code) => {
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}
