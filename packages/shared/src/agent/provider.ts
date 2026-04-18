import { z } from 'zod';

/** Provider adapters shipped in v1. `stub` is added in Phase 1.5 for tests. */
export const agentProviderIdSchema = z.enum(['claude', 'codex']);
export type AgentProviderId = z.infer<typeof agentProviderIdSchema>;
