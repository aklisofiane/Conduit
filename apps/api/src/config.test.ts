import { describe, expect, it } from 'vitest';
import { assertHostedSafety } from './config';

const HEX_KEY = 'a'.repeat(64);

function hostedEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    CONDUIT_DEPLOYMENT: 'hosted',
    BETTER_AUTH_SECRET: 'a-real-secret',
    CONDUIT_ENCRYPTION_KEY: HEX_KEY,
    ...overrides,
  };
}

describe('assertHostedSafety', () => {
  it('is a no-op for local deployments regardless of env', () => {
    expect(() => assertHostedSafety({ CONDUIT_DEPLOYMENT: 'local' })).not.toThrow();
    expect(() => assertHostedSafety({})).not.toThrow();
  });

  it('passes a fully configured hosted env', () => {
    expect(() => assertHostedSafety(hostedEnv())).not.toThrow();
  });

  it('rejects a missing BETTER_AUTH_SECRET', () => {
    expect(() => assertHostedSafety(hostedEnv({ BETTER_AUTH_SECRET: undefined }))).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it('rejects the public dev fallback secret', () => {
    expect(() =>
      assertHostedSafety(hostedEnv({ BETTER_AUTH_SECRET: 'dev-better-auth-secret-change-me' })),
    ).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('rejects a missing or non-hex encryption key', () => {
    expect(() => assertHostedSafety(hostedEnv({ CONDUIT_ENCRYPTION_KEY: undefined }))).toThrow(
      /CONDUIT_ENCRYPTION_KEY/,
    );
    expect(() =>
      assertHostedSafety(hostedEnv({ CONDUIT_ENCRYPTION_KEY: 'some passphrase' })),
    ).toThrow(/CONDUIT_ENCRYPTION_KEY/);
    expect(() =>
      assertHostedSafety(hostedEnv({ CONDUIT_ENCRYPTION_KEY: HEX_KEY.slice(0, 32) })),
    ).toThrow(/CONDUIT_ENCRYPTION_KEY/);
  });

  it('rejects WEBHOOK_DEV_SECRET being set at all', () => {
    expect(() => assertHostedSafety(hostedEnv({ WEBHOOK_DEV_SECRET: 'x' }))).toThrow(
      /WEBHOOK_DEV_SECRET/,
    );
  });

  it('reports every violation at once', () => {
    let message = '';
    try {
      assertHostedSafety({ CONDUIT_DEPLOYMENT: 'hosted', WEBHOOK_DEV_SECRET: 'x' });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/BETTER_AUTH_SECRET/);
    expect(message).toMatch(/CONDUIT_ENCRYPTION_KEY/);
    expect(message).toMatch(/WEBHOOK_DEV_SECRET/);
  });
});
