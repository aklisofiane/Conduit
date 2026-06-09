import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RunnerRequest } from '@conduit/shared/runner';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSpawnEnv, LocalProcessSpawner, SPAWN_ENV_DENYLIST } from './local-process';

/**
 * `buildSpawnEnv` carries the host-mode trust boundary: Docker forwards
 * only explicit `-e` vars, a child process inherits everything, so the
 * denylist below is the *only* thing keeping Conduit-internal secrets out
 * of the (unsandboxed) runner. Mirrors the invariant style of
 * `local-docker.test.ts`.
 */
describe('buildSpawnEnv', () => {
  it('strips every Conduit-internal secret on the denylist', () => {
    const base: NodeJS.ProcessEnv = {
      DATABASE_URL: 'postgres://x',
      REDIS_URL: 'redis://x',
      CONDUIT_ENCRYPTION_KEY: 'kek',
      BETTER_AUTH_SECRET: 'auth',
      WEBHOOK_DEV_SECRET: 'hook',
      GITHUB_CLIENT_SECRET: 'gh',
      ANTHROPIC_API_KEY: 'sk-ant',
      OPENAI_API_KEY: 'sk-oai',
      CLAUDE_CODE_OAUTH_TOKEN: 'oat',
    };
    const env = buildSpawnEnv(base);
    for (const key of SPAWN_ENV_DENYLIST) {
      expect(env, `${key} must not leak into the runner env`).not.toHaveProperty(key);
    }
    expect(Object.keys(env)).toHaveLength(0);
  });

  it("passes the user's toolchain env through untouched", () => {
    const base: NodeJS.ProcessEnv = {
      PATH: '/usr/bin:/opt/homebrew/bin',
      HOME: '/Users/u',
      ANDROID_HOME: '/opt/android',
      JAVA_HOME: '/opt/jdk',
      CONDUIT_HOME: '/Users/u/.conduit',
      CONDUIT_PROVIDER: 'stub',
    };
    expect(buildSpawnEnv(base)).toEqual(base);
  });

  it('does not mutate the input env', () => {
    const base: NodeJS.ProcessEnv = { DATABASE_URL: 'postgres://x', PATH: '/usr/bin' };
    buildSpawnEnv(base);
    expect(base.DATABASE_URL).toBe('postgres://x');
  });
});

/**
 * Spawner behavior against stub runner scripts — real child processes,
 * real process groups, no Docker. Each test writes its own stub script so
 * behaviors can't bleed between tests.
 */
describe('LocalProcessSpawner', () => {
  let tmpDir: string;
  let originalConduitHome: string | undefined;
  const runId = 'run-local-process-test';

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'conduit-local-process-'));
    originalConduitHome = process.env.CONDUIT_HOME;
    process.env.CONDUIT_HOME = path.join(tmpDir, 'conduit-home');
    await fs.mkdir(path.join(tmpDir, 'conduit-home', 'runs', runId), { recursive: true });
  });

  afterEach(async () => {
    if (originalConduitHome === undefined) delete process.env.CONDUIT_HOME;
    else process.env.CONDUIT_HOME = originalConduitHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const req = (): RunnerRequest =>
    ({ run: { runId, nodeName: 'Worker' } }) as unknown as RunnerRequest;

  const pidfile = (): string =>
    path.join(tmpDir, 'conduit-home', 'runs', runId, 'runner.pid');

  async function writeStub(name: string, body: string): Promise<string> {
    const file = path.join(tmpDir, name);
    await fs.writeFile(file, body);
    return file;
  }

  /** Stub that echoes the received request's runId, then exits cleanly. */
  const HAPPY_STUB = `
    let buf = '';
    process.stdin.on('data', (d) => (buf += d));
    process.stdin.on('end', () => {
      const req = JSON.parse(buf);
      process.stdout.write(JSON.stringify({ kind: 'system', message: 'runId=' + req.run.runId }) + '\\n');
      process.stdout.write(JSON.stringify({ kind: 'exit', ok: true, changedFiles: [], conduitSummary: null }) + '\\n');
      process.exit(0);
    });
  `;

  it('streams events from the runner and forwards the request on stdin', async () => {
    const entryPoint = await writeStub('happy.js', HAPPY_STUB);
    const spawner = new LocalProcessSpawner({ entryPoint });
    const handle = await spawner.spawn(req(), new AbortController().signal);
    const events = [];
    for await (const e of handle.events) events.push(e);
    expect(events).toEqual([
      { kind: 'system', message: `runId=${runId}` },
      { kind: 'exit', ok: true, changedFiles: [], conduitSummary: null },
    ]);
  });

  it('writes the pidfile while running and removes it once events end', async () => {
    const entryPoint = await writeStub(
      'pid.js',
      `
        process.stdin.resume();
        process.stdin.on('end', () => {
          // Hold the process open long enough for the test to observe the
          // pidfile, then exit terminally.
          setTimeout(() => {
            process.stdout.write(JSON.stringify({ kind: 'exit', ok: true, changedFiles: [], conduitSummary: null }) + '\\n');
            process.exit(0);
          }, 300);
        });
      `,
    );
    const spawner = new LocalProcessSpawner({ entryPoint });
    const handle = await spawner.spawn(req(), new AbortController().signal);
    const pid = Number.parseInt(await fs.readFile(pidfile(), 'utf8'), 10);
    expect(pid).toBeGreaterThan(0);
    for await (const _ of handle.events) {
      // drain
    }
    await expect(fs.access(pidfile())).rejects.toThrow();
  });

  it('yields a synthetic failed exit when the runner dies without a terminal event', async () => {
    const entryPoint = await writeStub(
      'crash.js',
      `
        process.stdin.resume();
        process.stdin.on('end', () => {
          process.stderr.write('boom: native tool missing\\n');
          process.exit(7);
        });
      `,
    );
    const spawner = new LocalProcessSpawner({ entryPoint });
    const handle = await spawner.spawn(req(), new AbortController().signal);
    const events = [];
    for await (const e of handle.events) events.push(e);
    expect(events).toHaveLength(1);
    const exit = events[0]!;
    expect(exit.kind).toBe('exit');
    if (exit.kind !== 'exit' || exit.ok) throw new Error('expected failed exit');
    expect(exit.error.message).toContain('code=7');
    expect(exit.error.message).toContain('boom: native tool missing');
  });

  it('cancel() kills the whole process group — SIGTERM-ignoring runner and its grandchild — and resolves only when gone', async () => {
    const grandchildPidFile = path.join(tmpDir, 'grandchild.pid');
    const entryPoint = await writeStub(
      'stubborn.js',
      `
        const { spawn } = require('node:child_process');
        const fs = require('node:fs');
        process.on('SIGTERM', () => {}); // refuse graceful shutdown
        process.stdin.resume();
        process.stdin.on('end', () => {
          // Grandchild in the same process group, also ignoring SIGTERM —
          // stands in for an MCP server the agent left running.
          const gc = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { stdio: 'ignore' });
          fs.writeFileSync(${JSON.stringify(grandchildPidFile)}, String(gc.pid));
          process.stdout.write(JSON.stringify({ kind: 'system', message: 'dug in' }) + '\\n');
          setInterval(() => {}, 1000); // stay alive forever
        });
      `,
    );
    const spawner = new LocalProcessSpawner({ entryPoint, killGraceMs: 300 });
    const handle = await spawner.spawn(req(), new AbortController().signal);

    const iterator = handle.events[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.value).toEqual({ kind: 'system', message: 'dug in' });
    const grandchildPid = Number.parseInt(await fs.readFile(grandchildPidFile, 'utf8'), 10);
    const runnerPid = Number.parseInt(await fs.readFile(pidfile(), 'utf8'), 10);

    await handle.cancel();

    expect(processAlive(runnerPid)).toBe(false);
    expect(processAlive(grandchildPid)).toBe(false);
    // Idempotent after the runner is gone.
    await expect(handle.cancel()).resolves.toBeUndefined();
    // Drain so the pump's finally-cleanup (pidfile removal) runs.
    while (!(await iterator.next()).done) {
      // discard trailing synthetic events
    }
  });

  it('resolves cancel() without escalation when the runner honours SIGTERM', async () => {
    const entryPoint = await writeStub(
      'graceful.js',
      `
        process.on('SIGTERM', () => process.exit(0));
        process.stdin.resume();
        process.stdin.on('end', () => {
          process.stdout.write(JSON.stringify({ kind: 'system', message: 'ready' }) + '\\n');
          setInterval(() => {}, 1000);
        });
      `,
    );
    // Generous grace: if SIGTERM alone didn't work this test would stall
    // toward the timeout instead of finishing in ~100ms.
    const spawner = new LocalProcessSpawner({ entryPoint, killGraceMs: 5_000 });
    const handle = await spawner.spawn(req(), new AbortController().signal);
    const iterator = handle.events[Symbol.asyncIterator]();
    await iterator.next();
    const started = Date.now();
    await handle.cancel();
    expect(Date.now() - started).toBeLessThan(2_000);
    while (!(await iterator.next()).done) {
      // drain
    }
  });
});

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
