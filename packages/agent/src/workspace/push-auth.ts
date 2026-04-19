import fs from 'node:fs/promises';
import path from 'node:path';
import { git } from './git';
import { runDir } from './paths';

/**
 * Install a `ticket-branch`-scoped git credential helper so the agent can
 * `git push` without the token ever being written to `.git/config` or the
 * remote URL.
 *
 * Shape:
 *   - A tiny POSIX shell script under `<runDir>/.credential-helpers/<node>.sh`
 *     (chmod 700) prints `username=x-access-token\npassword=<token>` on `get`.
 *   - `git config --local credential.helper '!<script>'` points the worktree
 *     at it. `--local` stores in the shared `.git/config`, so inherit-chain
 *     worktrees off the same base clone automatically pick it up — matches
 *     the "push env flows through inherit chain" expectation in
 *     docs/design-docs/branch-management.md.
 *
 * Cleanup: the helper dir lives inside `<runDir>`, so `cleanupRunActivity`
 * deletes it as part of the standard end-of-run cleanup.
 *
 * Security tradeoffs: the token lives on disk for the duration of the run
 * (chmod 700, inside a tmpdir the agent already has full access to). The
 * agent can read it. Acceptable per docs/SECURITY.md — a `ticket-branch`
 * agent already holds platform write access via its MCP servers, and push
 * is equivalent blast radius. Scoped env injection (token set only at the
 * git-shell boundary) is the deferred future mitigation.
 */
export async function installPushCredentials(args: {
  runId: string;
  nodeName: string;
  worktreePath: string;
  token: string;
}): Promise<void> {
  const { runId, nodeName, worktreePath, token } = args;
  const helperDir = path.join(runDir(runId), '.credential-helpers');
  await fs.mkdir(helperDir, { recursive: true, mode: 0o700 });
  const helperPath = path.join(helperDir, `${nodeName}.sh`);

  // Single-quoted sh literal — escape any embedded quotes. Tokens are
  // opaque strings from the platform; this is the only sanitization they
  // see before landing on disk.
  const quoted = `'${token.replace(/'/g, "'\\''")}'`;
  const script =
    `#!/bin/sh\n` +
    `# Conduit push credential helper for run ${runId} / node ${nodeName}.\n` +
    `# Auto-deleted when the run's workspace dir is cleaned up.\n` +
    `case "$1" in\n` +
    `  get)\n` +
    `    printf 'username=x-access-token\\npassword=%s\\n' ${quoted}\n` +
    `    ;;\n` +
    `esac\n`;
  await fs.writeFile(helperPath, script, { mode: 0o700 });

  // Wipe any inherited helper so the first `git push` hits ours. `--unset-all`
  // is a no-op if the key isn't set.
  await git(['config', '--local', '--unset-all', 'credential.helper'], {
    cwd: worktreePath,
  }).catch(() => undefined);
  await git(['config', '--local', 'credential.helper', `!${helperPath}`], {
    cwd: worktreePath,
  });
}
