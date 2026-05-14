import { z } from 'zod';
import { agentProviderIdSchema } from '../agent/provider';
import { agentRequestSchema } from '../runtime/request';
import { nodeNameSchema } from '../agent/node-name';

/**
 * One JSON object the orchestrator writes to the runner's stdin. Carries
 * everything the runner needs to execute a single agent node — and nothing
 * it doesn't. No DB connection, no Redis, no master KEK, no other
 * connections' credentials. MCP env/headers are already substituted; the
 * runner never sees `{{credential}}` placeholders.
 *
 * Transport-agnostic. Phase 1 carries this over local Docker stdin/stdout;
 * future phases swap the transport without changing the schema.
 */
export const runnerRequestSchema = z.object({
  protocolVersion: z.literal(1),
  /** Identity of this run — used for log labels and the conduit summary file name. */
  run: z.object({
    runId: z.string().min(1),
    workflowId: z.string().min(1),
    workflowName: z.string().min(1),
    nodeName: nodeNameSchema,
  }),
  /** Provider id + the API keys / tokens the runner SDK needs. Nothing else. */
  provider: z.object({
    id: agentProviderIdSchema,
    anthropicApiKey: z.string().optional(),
    openaiApiKey: z.string().optional(),
    /**
     * Long-lived Claude Code OAuth token produced by `claude setup-token`.
     * Lets the Claude SDK authenticate inside the runner without mounting
     * the user's `~/.claude/` directory. Read by the SDK from
     * `CLAUDE_CODE_OAUTH_TOKEN` env var; the runner exports it before
     * calling `resolveProvider`. Mutually exclusive in practice with
     * `anthropicApiKey` (the SDK prefers whichever is set).
     */
    claudeCodeOauthToken: z.string().optional(),
    /**
     * Optional base URL override forwarded to the SDK. Lets self-hosted
     * users point at LiteLLM / OpenAI-compatible proxies without redeploying
     * the worker. Claude reads it from `ANTHROPIC_BASE_URL`; Codex takes it
     * as a constructor option.
     */
    baseUrl: z.string().url().optional(),
    /**
     * Extra env vars exported into `process.env` before `resolveProvider`.
     * Reserved for future Bedrock-style auth (`CLAUDE_CODE_USE_BEDROCK=1` +
     * AWS access key + region). Same lifetime/trust boundary as the OAuth
     * token write — container exits at end of run.
     */
    extraEnv: z.record(z.string()).optional(),
  }),
  /** Already-resolved `AgentRequest` — MCP transports have credentials substituted. */
  agent: agentRequestSchema,
  /** Pre-rendered prompts for the three turns. */
  prompts: z.object({
    /** Main turn — serialized `AgentContext` (the user message). */
    main: z.string(),
    /** Optional issue-writeback turn — rendered orchestrator-side. */
    issueWriteback: z.string().optional(),
    /** Final summary turn — asks the agent to write `.conduit/<NodeName>.md`. */
    summary: z.string(),
  }),
  /**
   * Hard wall-clock cap on the runner. Optional — the orchestrator drives
   * cancellation through the transport (closing stdin, killing the
   * container) but a self-imposed timeout helps the runner exit cleanly.
   */
  timeoutMs: z.number().int().positive().optional(),
});
export type RunnerRequest = z.infer<typeof runnerRequestSchema>;
