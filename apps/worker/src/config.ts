import { DEFAULT_TEMPORAL_TASK_QUEUE } from '@conduit/shared';

export const config = {
  temporal: {
    address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? DEFAULT_TEMPORAL_TASK_QUEUE,
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
  // Long-lived Claude Code OAuth token from `claude setup-token`. Forwarded
  // to the runner via `RunnerRequest.provider`; the SDK reads it from
  // `CLAUDE_CODE_OAUTH_TOKEN` env. Lets local dev skip API keys without
  // mounting `~/.claude/` into the sandbox.
  claudeCodeOauthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN,
} as const;
