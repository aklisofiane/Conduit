import { afterEach, describe, expect, it } from 'vitest';
import { resolveRunnerMode } from './mode';

describe('resolveRunnerMode', () => {
  const originalDeployment = process.env.CONDUIT_DEPLOYMENT;
  const originalMode = process.env.CONDUIT_RUNNER_MODE;
  afterEach(() => {
    if (originalDeployment === undefined) delete process.env.CONDUIT_DEPLOYMENT;
    else process.env.CONDUIT_DEPLOYMENT = originalDeployment;
    if (originalMode === undefined) delete process.env.CONDUIT_RUNNER_MODE;
    else process.env.CONDUIT_RUNNER_MODE = originalMode;
  });

  const set = (deployment: string | undefined, mode: string | undefined): void => {
    if (deployment === undefined) delete process.env.CONDUIT_DEPLOYMENT;
    else process.env.CONDUIT_DEPLOYMENT = deployment;
    if (mode === undefined) delete process.env.CONDUIT_RUNNER_MODE;
    else process.env.CONDUIT_RUNNER_MODE = mode;
  };

  it('defaults to host when local and mode is unset', () => {
    set(undefined, undefined);
    expect(resolveRunnerMode()).toBe('host');
    set('local', undefined);
    expect(resolveRunnerMode()).toBe('host');
  });

  it('honours an explicit docker opt-in when local', () => {
    set('local', 'docker');
    expect(resolveRunnerMode()).toBe('docker');
  });

  it('accepts an explicit host when local', () => {
    set('local', 'host');
    expect(resolveRunnerMode()).toBe('host');
  });

  it('resolves to docker when hosted, whether mode is unset or explicit', () => {
    set('hosted', undefined);
    expect(resolveRunnerMode()).toBe('docker');
    set('hosted', 'docker');
    expect(resolveRunnerMode()).toBe('docker');
  });

  it('refuses to start when hosted and host mode is requested', () => {
    set('hosted', 'host');
    expect(() => resolveRunnerMode()).toThrow(/not allowed when CONDUIT_DEPLOYMENT=hosted/);
  });

  it('throws on an invalid runner mode rather than silently defaulting', () => {
    set('local', 'podman');
    expect(() => resolveRunnerMode()).toThrow(/CONDUIT_RUNNER_MODE/);
    set('hosted', 'podman');
    expect(() => resolveRunnerMode()).toThrow(/CONDUIT_RUNNER_MODE/);
  });

  it('throws on an invalid deployment value', () => {
    set('cloud', undefined);
    expect(() => resolveRunnerMode()).toThrow(/CONDUIT_DEPLOYMENT/);
  });

  it('treats empty strings as unset (the .env.example placeholder shape)', () => {
    set('', '');
    expect(resolveRunnerMode()).toBe('host');
    set('hosted', '');
    expect(resolveRunnerMode()).toBe('docker');
  });
});
