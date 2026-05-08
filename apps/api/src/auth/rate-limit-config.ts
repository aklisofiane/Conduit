import type { Deployment } from '../config';

export interface RateLimitConfig {
  enabled: boolean;
  window: number;
  max: number;
  storage: 'secondary-storage';
  customRules: Record<string, { window: number; max: number }>;
}

/**
 * Mode-aware rate-limit numbers per the operational-hardening spec table.
 *
 * | endpoint                                       | local (per IP) | hosted (per IP) |
 * | ---------------------------------------------- | -------------- | --------------- |
 * | `/sign-up/email`                               | 100 / hr       | 5 / hr          |
 * | `/sign-in/email`                               | 100 / hr       | 10 / 5min       |
 * | `/request-password-reset`                      | 100 / hr       | 5 / hr          |
 * | `/organization/accept-invitation`              | 100 / hr       | 10 / hr         |
 * | default for any other `/api/auth/*`            | 100 / min      | 100 / min       |
 *
 * `local` is *not* "off" — it's lenient enough to not punish dev iteration
 * but still prevents an accidental infinite loop from silently DOS'ing
 * Postgres. `hosted` numbers are conservative-but-usable: a real user won't
 * trip them; a script will.
 */
export function rateLimitConfig(deployment: Deployment): RateLimitConfig {
  const isHosted = deployment === 'hosted';
  return {
    enabled: true,
    window: 60,
    max: 100,
    storage: 'secondary-storage',
    customRules: isHosted
      ? {
          '/sign-up/email': { window: 60 * 60, max: 5 },
          '/sign-in/email': { window: 5 * 60, max: 10 },
          '/request-password-reset': { window: 60 * 60, max: 5 },
          '/organization/accept-invitation': { window: 60 * 60, max: 10 },
        }
      : {
          '/sign-up/email': { window: 60 * 60, max: 100 },
          '/sign-in/email': { window: 60 * 60, max: 100 },
          '/request-password-reset': { window: 60 * 60, max: 100 },
          '/organization/accept-invitation': { window: 60 * 60, max: 100 },
        },
  };
}
