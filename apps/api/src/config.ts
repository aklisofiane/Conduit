import { DEFAULT_TEMPORAL_TASK_QUEUE } from '@conduit/shared';

const githubClientId = process.env.GITHUB_CLIENT_ID ?? '';
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET ?? '';
const gitlabClientId = process.env.GITLAB_CLIENT_ID ?? '';
const gitlabClientSecret = process.env.GITLAB_CLIENT_SECRET ?? '';
export type Deployment = 'local' | 'hosted';
const deployment: Deployment =
  process.env.CONDUIT_DEPLOYMENT === 'hosted' ? 'hosted' : 'local';

const seedEmails: string[] = (process.env.CONDUIT_SEED_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter((e) => {
    if (!e) return false;
    if (e.startsWith('@') && !e.slice(1).includes('.')) return false;
    return true;
  });

const apiPort = Number.parseInt(process.env.API_PORT ?? '3000', 10);

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
    secret:
      process.env.BETTER_AUTH_SECRET ?? 'dev-better-auth-secret-change-me',
    baseURL:
      process.env.BETTER_AUTH_URL ?? `http://localhost:${apiPort}`,
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
