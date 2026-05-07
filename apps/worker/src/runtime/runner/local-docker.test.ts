import { describe, expect, it } from 'vitest';
import { buildDockerArgs } from './local-docker';

/**
 * Asserts the security-critical invariants from `.specs/docker-runner.md`
 * survive future refactors:
 *   - run-dir mount uses the same absolute path on both sides
 *   - bare-clone mount, when present, also uses the same absolute path
 *   - container UID is the host worker UID (never root)
 *   - no `--privileged`, no host networking, no docker.sock
 *   - container is labelled for orphan sweep
 */
describe('buildDockerArgs', () => {
  const base = {
    image: 'agent-runner:test',
    containerName: 'conduit-runner-r1-Worker',
    runId: 'r1',
    nodeName: 'Worker',
    runDirPath: '/home/u/.conduit/runs/r1',
    bareClone: null,
    uid: 1000,
    gid: 1000,
    authMounts: [],
    homeOverride: undefined,
    testMounts: [],
    forwardedEnv: {},
  };

  it('mounts the run dir at the same absolute path inside the container', () => {
    const args = buildDockerArgs(base);
    expect(args).toContain('-v');
    const mount = args[args.indexOf('-v') + 1];
    expect(mount).toBe('/home/u/.conduit/runs/r1:/home/u/.conduit/runs/r1:rw');
  });

  it('runs as host UID:GID, not root', () => {
    const args = buildDockerArgs(base);
    const userIdx = args.indexOf('--user');
    expect(userIdx).toBeGreaterThan(-1);
    expect(args[userIdx + 1]).toBe('1000:1000');
  });

  it('refuses to set --privileged, --network=host, or mount docker.sock', () => {
    const args = buildDockerArgs(base).join(' ');
    expect(args).not.toContain('--privileged');
    expect(args).not.toContain('--network=host');
    expect(args).not.toContain('/var/run/docker.sock');
  });

  it('labels containers for orphan sweep', () => {
    const args = buildDockerArgs(base);
    expect(args).toContain('conduit.runId=r1');
    expect(args).toContain('conduit.nodeName=Worker');
  });

  it('adds a same-path bind mount for the bare clone when present, and only that one', () => {
    const args = buildDockerArgs({
      ...base,
      bareClone: '/home/u/.conduit/base-clones/github/o/r.git',
    });
    const mounts = args.flatMap((a, i) => (args[i - 1] === '-v' ? [a] : []));
    expect(mounts).toEqual([
      '/home/u/.conduit/runs/r1:/home/u/.conduit/runs/r1:rw',
      '/home/u/.conduit/base-clones/github/o/r.git:/home/u/.conduit/base-clones/github/o/r.git:rw',
    ]);
  });

  it('puts the image as the last positional argument', () => {
    const args = buildDockerArgs(base);
    expect(args[args.length - 1]).toBe('agent-runner:test');
  });

  it('uses --rm and -i so the container is removed after exit and stdin is piped', () => {
    const args = buildDockerArgs(base);
    expect(args).toContain('--rm');
    expect(args).toContain('-i');
  });

  it('omits HOME and any auth bind mounts under api-key mode (default)', () => {
    const args = buildDockerArgs(base);
    expect(args.some((a) => a.startsWith('HOME='))).toBe(false);
    const mounts = args.flatMap((a, i) => (args[i - 1] === '-v' ? [a] : []));
    expect(mounts).toEqual(['/home/u/.conduit/runs/r1:/home/u/.conduit/runs/r1:rw']);
  });

  it('adds same-path bind mounts for testMounts and only those', () => {
    const args = buildDockerArgs({
      ...base,
      testMounts: ['/tmp/conduit-e2e-abc123'],
    });
    const mounts = args.flatMap((a, i) => (args[i - 1] === '-v' ? [a] : []));
    expect(mounts).toEqual([
      '/home/u/.conduit/runs/r1:/home/u/.conduit/runs/r1:rw',
      '/tmp/conduit-e2e-abc123:/tmp/conduit-e2e-abc123:rw',
    ]);
  });

  it('forwards entries from forwardedEnv as `-e KEY=VALUE`', () => {
    const args = buildDockerArgs({
      ...base,
      forwardedEnv: { CONDUIT_PROVIDER: 'stub', CONDUIT_STUB_SCRIPT: '/tmp/s.json' },
    });
    const envs = args.flatMap((a, i) => (args[i - 1] === '-e' ? [a] : []));
    expect(envs).toContain('CONDUIT_PROVIDER=stub');
    expect(envs).toContain('CONDUIT_STUB_SCRIPT=/tmp/s.json');
  });

  it('adds the codex auth.json mount and HOME under oauth-mount mode', () => {
    // Claude is intentionally absent — its OAuth path is the
    // `CLAUDE_CODE_OAUTH_TOKEN` env var carried in `RunnerRequest`, not a
    // bind mount. Only Codex still needs its on-disk auth.json.
    const args = buildDockerArgs({
      ...base,
      authMounts: ['/home/u/.codex/auth.json'],
      homeOverride: '/home/u',
    });
    const mounts = args.flatMap((a, i) => (args[i - 1] === '-v' ? [a] : []));
    expect(mounts).toContain('/home/u/.codex/auth.json:/home/u/.codex/auth.json:rw');
    expect(mounts.some((m) => m.includes('.claude'))).toBe(false);
    const envIdx = args.indexOf('-e');
    expect(envIdx).toBeGreaterThan(-1);
    expect(args[envIdx + 1]).toBe('HOME=/home/u');
  });
});
