import os from 'node:os';
import path from 'node:path';

/** Root for everything Conduit writes on disk (overridable for tests). */
export function conduitHome(): string {
  return process.env.CONDUIT_HOME ?? path.join(os.homedir(), '.conduit');
}

export function runsRoot(): string {
  return path.join(conduitHome(), 'runs');
}

export function baseClonesRoot(): string {
  return path.join(conduitHome(), 'base-clones');
}

export function runDir(runId: string): string {
  return path.join(runsRoot(), runId);
}

export function nodeWorkspacePath(runId: string, nodeName: string): string {
  return path.join(runDir(runId), nodeName);
}

/** Absolute path of the bare base clone for `<platform>/<owner>/<repo>`. */
export function baseClonePath(platform: string, owner: string, repo: string): string {
  return path.join(baseClonesRoot(), platform, owner, `${repo}.git`);
}
