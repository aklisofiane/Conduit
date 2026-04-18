import { spawn } from 'node:child_process';

export class GitError extends Error {
  override readonly name = 'GitError';
  constructor(
    message: string,
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(message);
  }
}

/**
 * Run git with a tight interface: capture stdout/stderr, throw on non-zero.
 * Kept narrow — workspace manager is the only caller. Not for agent-visible
 * shell.
 */
export async function git(
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => err.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      const stderr = Buffer.concat(err).toString('utf8');
      if (code !== 0) {
        reject(new GitError(`git ${args[0] ?? ''} failed (${code}): ${stderr.trim()}`, code ?? -1, stderr));
        return;
      }
      resolve(Buffer.concat(out).toString('utf8'));
    });
  });
}
