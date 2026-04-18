/**
 * Central env reader. Call sites import typed helpers instead of
 * `process.env.FOO` so we catch misconfiguration at boot.
 */
export const config = {
  port: Number.parseInt(process.env.API_PORT ?? '3001', 10),
  apiKey: process.env.CONDUIT_API_KEY ?? '',
  corsOrigin: process.env.CONDUIT_CORS_ORIGIN ?? 'http://localhost:5173',
  temporal: {
    address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? 'conduit-workflows',
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
} as const;
