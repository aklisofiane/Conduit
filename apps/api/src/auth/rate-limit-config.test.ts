import { describe, expect, it } from 'vitest';
import { rateLimitConfig } from './rate-limit-config';

/**
 * Pure-data unit test against `rateLimitConfig` — the source of truth for
 * the operational-hardening rate-limit table. We assert on the exact rule
 * objects so a future config drift surfaces here loudly.
 */
describe('rateLimitConfig', () => {
  it('local mode is lenient: 100/hr on every protected endpoint', () => {
    const cfg = rateLimitConfig('local');
    expect(cfg.enabled).toBe(true);
    expect(cfg.storage).toBe('secondary-storage');
    expect(cfg.window).toBe(60);
    expect(cfg.max).toBe(100);
    expect(cfg.customRules).toEqual({
      '/sign-up/email': { window: 3600, max: 100 },
      '/sign-in/email': { window: 3600, max: 100 },
      '/request-password-reset': { window: 3600, max: 100 },
      '/organization/accept-invitation': { window: 3600, max: 100 },
    });
  });

  it('hosted mode tightens per the spec table', () => {
    const cfg = rateLimitConfig('hosted');
    expect(cfg.customRules).toEqual({
      '/sign-up/email': { window: 3600, max: 5 },
      '/sign-in/email': { window: 300, max: 10 },
      '/request-password-reset': { window: 3600, max: 5 },
      '/organization/accept-invitation': { window: 3600, max: 10 },
    });
  });

  it('default rule (100/min) is identical across modes', () => {
    expect(rateLimitConfig('local').window).toBe(60);
    expect(rateLimitConfig('local').max).toBe(100);
    expect(rateLimitConfig('hosted').window).toBe(60);
    expect(rateLimitConfig('hosted').max).toBe(100);
  });
});
