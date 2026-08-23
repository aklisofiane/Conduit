import { DEFAULT_TEMPORAL_TASK_QUEUE } from '@conduit/shared';

const githubClientId = process.env.GITHUB_CLIENT_ID ?? '';
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET ?? '';
const gitlabClientId = process.env.GITLAB_CLIENT_ID ?? '';
const gitlabClientSecret = process.env.GITLAB_CLIENT_SECRET ?? '';
export type Deployment = 'local' | 'hosted';
const deployment: Deployment = process.env.CONDUIT_DEPLOYMENT === 'hosted' ? 'hosted' : 'local';

const seedEmails: string[] = (process.env.CONDUIT_SEED_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter((e) => {
    if (!e) return false;
    if (e.startsWith('@') && !e.slice(1).includes('.')) return false;
    return true;
  });

const apiPort = Number.parseInt(process.env.API_PORT ?? '3000', 10);

// Dev-only fallback so a fresh checkout boots without any env. This value is
// public (it's in the repo) — `assertHostedSafety` refuses to boot hosted
// with it, since Better Auth would sign every session with a known secret.
const DEV_BETTER_AUTH_SECRET = 'dev-better-auth-secret-change-me';

/**
 * Central env reader. Call sites import typed helpers instead of
 * `process.env.FOO` so we catch misconfiguration at boot.
 */
export const config = {
  port: apiPort,
  deployment,
  seedEmails,
  corsOrigin: process.env.CONDUIT_CORS_ORIGIN ?? 'http://localhost:5173',
  temporal: {
    address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? DEFAULT_TEMPORAL_TASK_QUEUE,
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  betterAuth: {
    // Better Auth signs cookies + tokens with this. Required in production;
    // in dev we default to a stable string so a fresh checkout boots.
    secret: process.env.BETTER_AUTH_SECRET ?? DEV_BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL ?? `http://localhost:${apiPort}`,
    // GitHub OAuth surfaces only when both halves are set, in either deployment.
    githubOAuth:
      githubClientId && githubClientSecret
        ? { clientId: githubClientId, clientSecret: githubClientSecret }
        : undefined,
    // GitLab OAuth — same conditional shape as GitHub.
    gitlabOAuth:
      gitlabClientId && gitlabClientSecret
        ? { clientId: gitlabClientId, clientSecret: gitlabClientSecret }
        : undefined,
  },
} as const;

/**
 * Fail-closed checks for hosted deployments, called once at bootstrap.
 * The dev conveniences these guard (auth-secret fallback, auto-generated
 * encryption key, webhook HMAC bypass) exist so a fresh checkout boots with
 * zero env — none of them may survive into a deployment that serves real
 * tenants. Mirrors the worker's refusal of `hosted` + host runner mode.
 */
export function assertHostedSafety(env: NodeJS.ProcessEnv = process.env): void {
  if (env.CONDUIT_DEPLOYMENT !== 'hosted') return;
  const problems: string[] = [];
  const authSecret = env.BETTER_AUTH_SECRET;
  if (!authSecret || authSecret === DEV_BETTER_AUTH_SECRET) {
    problems.push(
      'BETTER_AUTH_SECRET must be set to a private value — the dev fallback is public and makes sessions forgeable.',
    );
  }
  const encKey = env.CONDUIT_ENCRYPTION_KEY;
  if (!encKey || !/^[0-9a-fA-F]{64}$/.test(encKey.trim())) {
    problems.push(
      'CONDUIT_ENCRYPTION_KEY must be an explicit 64-hex key — auto-generated and passphrase-derived keys are local-only.',
    );
  }
  if (env.WEBHOOK_DEV_SECRET) {
    problems.push('WEBHOOK_DEV_SECRET must not be set — it bypasses webhook HMAC verification.');
  }
  if (problems.length > 0) {
    throw new Error(
      `Refusing to boot with CONDUIT_DEPLOYMENT=hosted:\n - ${problems.join('\n - ')}`,
    );
  }
}
