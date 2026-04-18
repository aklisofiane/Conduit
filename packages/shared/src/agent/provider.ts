import { z } from 'zod';

/** Provider adapters shipped in v1. */
export const agentProviderIdSchema = z.enum(['claude', 'codex']);
export type AgentProviderId = z.infer<typeof agentProviderIdSchema>;
