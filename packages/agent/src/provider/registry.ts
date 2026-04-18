import type { AgentProviderId } from '@conduit/shared';
import { ClaudeProvider } from './claude-provider.js';
import type { AgentProvider } from './types.js';

/**
 * Selects a provider adapter by id. Codex lands in Phase 2; for Phase 1 a
 * call site that asks for it gets a clear error rather than a silent stub.
 */
export function resolveProvider(
  id: AgentProviderId,
  opts: { anthropicApiKey?: string } = {},
): AgentProvider {
  switch (id) {
    case 'claude':
      return new ClaudeProvider({ apiKey: opts.anthropicApiKey });
    case 'codex':
      throw new Error('Codex provider is not implemented in Phase 1 — see docs/PLANS.md');
    default: {
      const _exhaustive: never = id;
      throw new Error(`Unknown provider: ${String(_exhaustive)}`);
    }
  }
}
