import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { baseClonePath, baseClonesRoot, conduitHome, runDir, runsRoot } from './paths';

describe('paths', () => {
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.CONDUIT_HOME;
    process.env.CONDUIT_HOME = '/tmp/conduit-test-paths';
  });

  afterEach(() => {
    process.env.CONDUIT_HOME = originalHome;
  });

  describe('baseClonePath', () => {
    it('produces <root>/<platform>/<host>/<owner>/<repo>.git for a cloud host', () => {
      const p = baseClonePath('github', 'github.com', 'acme', 'api');
      expect(p).toBe(
        path.join(
          '/tmp/conduit-test-paths',
          'base-clones',
          'github',
          'github.com',
          'acme',
          'api.git',
        ),
      );
    });

    it('produces <root>/<platform>/<host>/<owner>/<repo>.git for gitlab cloud', () => {
      const p = baseClonePath('gitlab', 'gitlab.com', 'acme', 'frontend');
      expect(p).toBe(
        path.join(
          '/tmp/conduit-test-paths',
          'base-clones',
          'gitlab',
          'gitlab.com',
          'acme',
          'frontend.git',
        ),
      );
    });

    it('handles self-hosted hosts without port', () => {
      const p = baseClonePath('github', 'ghe.example.com', 'acme', 'api');
      expect(p).toBe(
        path.join(
          '/tmp/conduit-test-paths',
          'base-clones',
          'github',
          'ghe.example.com',
          'acme',
          'api.git',
        ),
      );
    });

    it('handles self-hosted hosts with port', () => {
      const p = baseClonePath('gitlab', 'gitlab.acme.io:8443', 'ops', 'deploy');
      expect(p).toBe(
        path.join(
          '/tmp/conduit-test-paths',
          'base-clones',
          'gitlab',
          'gitlab.acme.io:8443',
          'ops',
          'deploy.git',
        ),
      );
    });

    it('different hosts for the same owner/repo produce distinct paths', () => {
      const cloud = baseClonePath('github', 'github.com', 'acme', 'api');
      const selfHosted = baseClonePath('github', 'ghe.example.com', 'acme', 'api');
      expect(cloud).not.toBe(selfHosted);
    });
  });

  describe('conduitHome', () => {
    it('uses CONDUIT_HOME env var when set', () => {
      expect(conduitHome()).toBe('/tmp/conduit-test-paths');
    });

    it('falls back to ~/.conduit when env var is unset', () => {
      delete process.env.CONDUIT_HOME;
      expect(conduitHome()).toBe(path.join(os.homedir(), '.conduit'));
    });
  });

  describe('runsRoot / baseClonesRoot / runDir', () => {
    it('nests under conduitHome', () => {
      expect(runsRoot()).toBe(path.join('/tmp/conduit-test-paths', 'runs'));
      expect(baseClonesRoot()).toBe(path.join('/tmp/conduit-test-paths', 'base-clones'));
      expect(runDir('run_42')).toBe(path.join('/tmp/conduit-test-paths', 'runs', 'run_42'));
    });
  });
});
