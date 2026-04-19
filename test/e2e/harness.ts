import { type ChildProcess, spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { StubScript } from '@conduit/agent';
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
  http: HttpClient;
  /**
   * Subscribe to a run's Socket.IO room. Call `.frames()` to await frames,
   * `.waitForDone(nodeName)` to block until a `done` event arrives, `.close()`
   * on teardown.
   */
  collectRun(runId: string): WsCollector;
  /** Write `script` to the stub script file so the next run consumes it. */
  setStubScript(script: StubScript): Promise<void>;
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

  const env = {
    ...process.env,
    ...TEST_STACK_ENV,
    CONDUIT_PROVIDER: 'stub',
    CONDUIT_STUB_SCRIPT: stubScriptPath,
    CONDUIT_API_KEY: apiKey,
    CONDUIT_CORS_ORIGIN: 'http://localhost',
    API_PORT: String(apiPort),
    CONDUIT_HOME: path.join(workspaceRoot, 'conduit-home'),
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
    http,
    collectRun: (runId) => makeCollector(`${apiUrl}/runs`, runId),
    async setStubScript(script) {
      await fs.writeFile(stubScriptPath, JSON.stringify(script));
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
