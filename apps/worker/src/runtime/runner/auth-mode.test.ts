import { afterEach, describe, expect, it } from 'vitest';
import { resolveAgentAuthMode } from './auth-mode';

describe('resolveAgentAuthMode', () => {
  const original = process.env.CONDUIT_AGENT_AUTH;
  afterEach(() => {
    if (original === undefined) delete process.env.CONDUIT_AGENT_AUTH;
    else process.env.CONDUIT_AGENT_AUTH = original;
  });

  it('defaults to api-key when unset', () => {
    delete process.env.CONDUIT_AGENT_AUTH;
    expect(resolveAgentAuthMode()).toBe('api-key');
  });

  it('returns oauth-mount when explicitly set', () => {
    process.env.CONDUIT_AGENT_AUTH = 'oauth-mount';
    expect(resolveAgentAuthMode()).toBe('oauth-mount');
  });

  it('throws on unknown values rather than silently defaulting', () => {
    process.env.CONDUIT_AGENT_AUTH = 'whatever';
    expect(() => resolveAgentAuthMode()).toThrow(/CONDUIT_AGENT_AUTH/);
  });
});
