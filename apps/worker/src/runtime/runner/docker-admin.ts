import { spawn } from 'node:child_process';
import { errorMessage } from '@conduit/shared/runtime';
import { findOrphanedRunIds } from './orphans';

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
 * Best-effort: a docker error or a missing run row never fails startup. A
 * DB error skips the sweep entirely — it must not make live runs look
 * missing and get their containers killed.
 */
export async function sweepOrphans(): Promise<void> {
  const live = await listConduitContainers();
  if (live.length === 0) return;

  const orphanedRunIds = await findOrphanedRunIds([...new Set(live.map((c) => c.runId))]);
  if (orphanedRunIds === null) return; // DB unreachable — retry on the next boot

  const orphans = live.filter((c) => orphanedRunIds.has(c.runId));
  if (orphans.length === 0) return;
  await Promise.all(
    orphans.map((c) => runCommand('docker', ['kill', c.id]).catch(() => undefined)),
  );
}

interface ContainerInfo {
  id: string;
  runId: string;
}

async function listConduitContainers(): Promise<ContainerInfo[]> {
  // `docker ps --format` with a literal `\t` between fields lets us read the
  // runId label in the same call — saves an `inspect` per container at
  // worker boot.
  const result = await runCommand('docker', [
    'ps',
    '--filter',
    'label=conduit.runId',
    '--format',
    '{{.ID}}\t{{ index .Labels "conduit.runId" }}',
  ]);
  if (result.code !== 0) return [];
  const out: ContainerInfo[] = [];
  for (const line of result.stdout.split('\n')) {
    const [id, runId] = line.split('\t');
    if (id && runId) out.push({ id: id.trim(), runId: runId.trim() });
  }
  return out;
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
        stderr: errorMessage(err),
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
