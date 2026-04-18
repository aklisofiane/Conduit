import type { AgentProviderId } from '@conduit/shared';
import { ClaudeProvider } from './claude-provider';
import type { AgentProvider } from './types';

/**
 * Selects a provider adapter by id. The Codex adapter isn't implemented
 * yet — call sites that ask for it get a clear error rather than a silent
 * stub. See docs/PLANS.md for the rollout order.
 */
export function resolveProvider(
  id: AgentProviderId,
  opts: { anthropicApiKey?: string } = {},
): AgentProvider {
  switch (id) {
    case 'claude':
      return new ClaudeProvider({ apiKey: opts.anthropicApiKey });
    case 'codex':
      throw new Error('Codex provider is not yet implemented — see docs/PLANS.md');
    default: {
      const _exhaustive: never = id;
      throw new Error(`Unknown provider: ${String(_exhaustive)}`);
    }
  }
}
