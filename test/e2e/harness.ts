import { type ChildProcess, spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { io as ioClient, type Socket } from 'socket.io-client';
import { spawn as spawnChild } from 'node:child_process';
import type { StubScript, StubSessionBundle, StubSessionScript } from '@conduit/agent';
import type { RunUpdateMessage } from '@conduit/shared';
import { TEST_STACK_ENV } from './stack';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

export interface HarnessOptions {
  /** API key used for requests + env. Tests share one key by default. */
  apiKey?: string;
  /** Extra env vars merged into api + worker subprocesses. */
  extraEnv?: Record<string, string>;
}

export interface Harness {
  apiUrl: string;
  wsUrl: string;
  apiKey: string;
  stubScriptPath: string;
  /** Root dir used for workspace tmpdirs, base clones, etc. Same as CONDUIT_HOME env. */
  conduitHome: string;
  http: HttpClient;
  /**
   * Subscribe to a run's Socket.IO room. Call `.frames()` to await frames,
   * `.waitForDone(nodeName)` to block until a `done` event arrives, `.close()`
   * on teardown.
   */
  collectRun(runId: string): WsCollector;
  /** Write a single-turn `script` to the stub script file. */
  setStubScript(script: StubScript): Promise<void>;
  /** Write a multi-turn `session` to the stub script file (one script per `run()`). */
  setStubSession(session: StubSessionScript): Promise<void>;
  /** Write a bundle of sessions (consumed FIFO, one per `startSession()` across nodes). */
  setStubBundle(bundle: StubSessionBundle): Promise<void>;
  /**
   * Pre-seed a base clone under `conduitHome/base-clones/github/<owner>/<repo>.git`
   * pointing at a freshly-initialized local repo with a handful of seed files.
   * Skips the real GitHub clone step at run time — `repo-clone` workspaces
   * resolve against this local bare repo instead. Returns the path of the
   * seed working clone so tests can inspect it if needed.
   */
  seedRepoClone(owner: string, repo: string, seedFiles?: Record<string, string>): Promise<string>;
  stop(): Promise<void>;
}

export interface HttpClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  del(path: string): Promise<void>;
}

export interface WsCollector {
  frames(): RunUpdateMessage[];
  waitForDone(nodeName?: string, timeoutMs?: number): Promise<RunUpdateMessage>;
  close(): void;
}

export async function startHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const apiKey = opts.apiKey ?? 'test-api-key';
  const apiPort = await freePort();
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'conduit-e2e-'));
  const stubScriptPath = path.join(workspaceRoot, 'stub-script.json');
  await fs.writeFile(stubScriptPath, JSON.stringify({ steps: [{ kind: 'done' }] }));

  // Each harness owns its own Temporal task queue so parallel e2e test files
  // can't steal each other's agent workflows. Postgres rows are still unique
  // per workflow, but without a queue split, worker subprocesses race to
  // dequeue tasks from the shared `conduit-agent` queue and cross-run frames
  // end up on the wrong WS.
  const taskQueue = `conduit-agent-${path.basename(workspaceRoot)}`;
  const env = {
    ...process.env,
    ...TEST_STACK_ENV,
    CONDUIT_PROVIDER: 'stub',
    CONDUIT_STUB_SCRIPT: stubScriptPath,
    CONDUIT_API_KEY: apiKey,
    CONDUIT_CORS_ORIGIN: 'http://localhost',
    API_PORT: String(apiPort),
    CONDUIT_HOME: path.join(workspaceRoot, 'conduit-home'),
    TEMPORAL_TASK_QUEUE: taskQueue,
    ...opts.extraEnv,
  };

  // Piping stdout/stderr without draining them will eventually block the child
  // on a full kernel pipe buffer. Only open the pipes when we actually plan to
  // read them.
  const streamLogs = process.env.CONDUIT_TEST_STREAM_LOGS === '1';
  const childStdio: ['ignore', 'ignore' | 'pipe', 'ignore' | 'pipe'] = streamLogs
    ? ['ignore', 'pipe', 'pipe']
    : ['ignore', 'ignore', 'ignore'];

  const api = spawn('node', ['dist/main.js'], {
    cwd: path.join(REPO_ROOT, 'apps', 'api'),
    env,
    stdio: childStdio,
  });
  const worker = spawn('node', ['dist/main.js'], {
    cwd: path.join(REPO_ROOT, 'apps', 'worker'),
    env,
    stdio: childStdio,
  });

  if (streamLogs) {
    pipeOutput('api', api);
    pipeOutput('worker', worker);
  }

  const conduitHome = env.CONDUIT_HOME;
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  try {
    await waitForHealth(`${apiUrl}/api/health`, 30_000);
  } catch (err) {
    api.kill('SIGTERM');
    worker.kill('SIGTERM');
    await Promise.all([waitExit(api), waitExit(worker)]);
    await fs.rm(workspaceRoot, { recursive: true, force: true });
    throw err;
  }

  const http = makeHttpClient(apiUrl, apiKey);

  return {
    apiUrl,
    wsUrl: `${apiUrl}/runs`,
    apiKey,
    stubScriptPath,
    conduitHome,
    http,
    collectRun: (runId) => makeCollector(`${apiUrl}/runs`, runId),
    async setStubScript(script) {
      await fs.writeFile(stubScriptPath, JSON.stringify(script));
    },
    async setStubSession(session) {
      await fs.writeFile(stubScriptPath, JSON.stringify(session));
    },
    async setStubBundle(bundle) {
      await fs.writeFile(stubScriptPath, JSON.stringify(bundle));
    },
    async seedRepoClone(owner, repo, seedFiles = {}) {
      return seedBaseClone(conduitHome, workspaceRoot, owner, repo, seedFiles);
    },
    async stop() {
      api.kill('SIGTERM');
      worker.kill('SIGTERM');
      await Promise.all([waitExit(api), waitExit(worker)]);
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    },
  };
}

function makeHttpClient(apiUrl: string, apiKey: string): HttpClient {
  const headers = { 'content-type': 'application/json', 'x-api-key': apiKey };
  async function call<T>(method: string, urlPath: string, body?: unknown): Promise<T> {
    const res = await fetch(`${apiUrl}/api${urlPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`${method} ${urlPath} → ${res.status}: ${await res.text()}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
  return {
    get: (p) => call('GET', p),
    post: (p, body) => call('POST', p, body),
    put: (p, body) => call('PUT', p, body),
    del: (p) => call('DELETE', p),
  };
}

function makeCollector(wsUrl: string, runId: string): WsCollector {
  const frames: RunUpdateMessage[] = [];
  const socket: Socket = ioClient(wsUrl, {
    transports: ['websocket'],
    query: { runId },
    forceNew: true,
  });
  socket.on('node-update', (msg: RunUpdateMessage) => frames.push(msg));

  return {
    frames: () => [...frames],
    waitForDone: (nodeName, timeoutMs = 30_000) =>
      new Promise<RunUpdateMessage>((resolve, reject) => {
        // Some frames may have landed before `waitForDone` is called; scan first.
        const match = (m: RunUpdateMessage): boolean =>
          m.event.type === 'done' && (!nodeName || m.nodeName === nodeName);
        const existing = frames.find(match);
        if (existing) return resolve(existing);

        const timer = setTimeout(() => {
          socket.off('node-update', onFrame);
          reject(new Error(`Timed out after ${timeoutMs}ms waiting for done${nodeName ? `/${nodeName}` : ''}`));
        }, timeoutMs);

        const onFrame = (m: RunUpdateMessage): void => {
          if (match(m)) {
            clearTimeout(timer);
            socket.off('node-update', onFrame);
            resolve(m);
          }
        };
        socket.on('node-update', onFrame);
      }),
    close: () => {
      socket.disconnect();
    },
  };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close();
        return reject(new Error('Could not reserve a free port'));
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await sleep(200);
  }
  throw new Error(`API health check did not succeed within ${timeoutMs}ms: ${String(lastErr)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pipeOutput(prefix: string, child: ChildProcess): void {
  (child.stdout as Readable | null)?.on('data', (chunk: Buffer) =>
    process.stdout.write(`[${prefix}] ${chunk}`),
  );
  (child.stderr as Readable | null)?.on('data', (chunk: Buffer) =>
    process.stderr.write(`[${prefix}] ${chunk}`),
  );
}

/**
 * Seed a bare repo at the path the workspace manager expects, plus a sibling
 * working clone with an initial commit. Remote `origin` on the bare repo
 * points at the working clone so the manager's `git fetch origin` succeeds
 * against the local filesystem instead of hitting the real GitHub URL.
 */
async function seedBaseClone(
  conduitHome: string,
  workspaceRoot: string,
  owner: string,
  repo: string,
  seedFiles: Record<string, string>,
): Promise<string> {
  const baseBareDir = path.join(conduitHome, 'base-clones', 'github', owner, `${repo}.git`);
  const seedRoot = path.join(workspaceRoot, 'seed-repos', owner, repo);
  if (
    await fs
      .stat(baseBareDir)
      .then((s) => s.isDirectory())
      .catch(() => false)
  ) {
    // Already seeded by an earlier test in this harness — nothing to do.
    return seedRoot;
  }

  await fs.mkdir(seedRoot, { recursive: true });
  await gitCmd(seedRoot, ['init', '-q', '-b', 'main']);
  await gitCmd(seedRoot, ['config', 'user.email', 'seed@conduit.test']);
  await gitCmd(seedRoot, ['config', 'user.name', 'Seed']);

  const files: Record<string, string> = {
    'README.md': '# Seed repo\n\nGenerated by Conduit e2e harness.\n',
    ...seedFiles,
  };
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(seedRoot, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
  await gitCmd(seedRoot, ['add', '-A']);
  await gitCmd(seedRoot, ['commit', '-q', '-m', 'seed: initial commit']);

  await fs.mkdir(path.dirname(baseBareDir), { recursive: true });
  await gitCmd(path.dirname(baseBareDir), ['clone', '--bare', '-q', seedRoot, baseBareDir]);
  // Point the bare clone at the working seed so fetch can run off the
  // filesystem — bypasses the hardcoded github.com URL in connection-context.
  await gitCmd(baseBareDir, ['remote', 'set-url', 'origin', seedRoot]);
  return seedRoot;
}

function gitCmd(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnChild('git', args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    const err: Buffer[] = [];
    child.stderr?.on('data', (c: Buffer) => err.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`git ${args.join(' ')} (cwd=${cwd}) exited ${code}: ${Buffer.concat(err).toString()}`));
    });
  });
}

function waitExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    // Safety net — SIGKILL after 5s if SIGTERM was ignored.
    const killTimer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 5_000);
    killTimer.unref();
    child.once('exit', () => {
      clearTimeout(killTimer);
      resolve();
    });
  });
}
