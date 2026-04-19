import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git } from './git';
import { installPushCredentials } from './push-auth';

/**
 * Runs the helper git actually installs and verifies `git credential fill`
 * reads our embedded token back. Catches shell-escape regressions without
 * needing a real platform push.
 */

describe('installPushCredentials', () => {
  let conduitHome: string;
  let originalHome: string | undefined;
  let worktree: string;
  let gitSandboxEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    originalHome = process.env.CONDUIT_HOME;
    conduitHome = await fs.mkdtemp(path.join(os.tmpdir(), 'conduit-push-auth-'));
    process.env.CONDUIT_HOME = conduitHome;

    // Isolate git from the developer's ~/.gitconfig and OS keychain helpers
    // so the test sees only the helper we install. Without this the user's
    // macOS keychain leaks real tokens into the assertion.
    const isolatedHome = path.join(conduitHome, 'home');
    await fs.mkdir(isolatedHome);
    gitSandboxEnv = {
      ...process.env,
      HOME: isolatedHome,
      XDG_CONFIG_HOME: path.join(isolatedHome, '.config'),
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
    };

    worktree = path.join(conduitHome, 'runs', 'run_1', 'Worker');
    await fs.mkdir(worktree, { recursive: true });
    await git(['init', '-q'], { cwd: worktree });
  });

  afterEach(async () => {
    process.env.CONDUIT_HOME = originalHome;
    await fs.rm(conduitHome, { recursive: true, force: true });
  });

  it('makes git credential fill return our token on get', async () => {
    await installPushCredentials({
      runId: 'run_1',
      nodeName: 'Worker',
      worktreePath: worktree,
      token: 'ghp_abc123!',
    });

    const out = await runGitCredentialFill(worktree, 'https://github.com/acme/shop.git', gitSandboxEnv);
    expect(out).toContain('username=x-access-token');
    expect(out).toContain('password=ghp_abc123!');
  });

  it('survives single-quoted tokens without breaking the helper', async () => {
    await installPushCredentials({
      runId: 'run_1',
      nodeName: 'Worker',
      worktreePath: worktree,
      token: "tok'en-with-'quotes",
    });

    const out = await runGitCredentialFill(worktree, 'https://github.com/acme/shop.git', gitSandboxEnv);
    expect(out).toContain("password=tok'en-with-'quotes");
  });
});

/**
 * `git credential fill` reads a URL on stdin and asks the configured helpers
 * for a matching credential. If the helper doesn't respond, git falls back to
 * prompting — `GIT_TERMINAL_PROMPT=0` turns that into a hard failure so the
 * test doesn't hang.
 */
async function runGitCredentialFill(
  cwd: string,
  url: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['credential', 'fill'], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => err.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(
          new Error(
            `git credential fill exited ${code}: ${Buffer.concat(err).toString().trim()}`,
          ),
        );
      }
      resolve(Buffer.concat(out).toString());
    });
    const parsed = new URL(url);
    const input =
      `protocol=${parsed.protocol.replace(':', '')}\n` +
      `host=${parsed.host}\n` +
      `path=${parsed.pathname.replace(/^\//, '')}\n\n`;
    child.stdin.write(input);
    child.stdin.end();
  });
}
