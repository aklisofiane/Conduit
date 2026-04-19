import type { AgentProviderId } from '@conduit/shared';
import { ClaudeProvider } from './claude-provider';
import { StubProvider } from './stub-provider';
import type { AgentProvider } from './types';

/**
 * Selects a provider adapter by id. When `CONDUIT_PROVIDER=stub` is set,
 * returns a `StubProvider` masquerading as the requested id so tests can
 * exercise provider-specific code paths without the real SDK. See
 * docs/VALIDATION.md.
 */
export function resolveProvider(
  id: AgentProviderId,
  opts: { anthropicApiKey?: string } = {},
): AgentProvider {
  if (process.env.CONDUIT_PROVIDER === 'stub') {
    return new StubProvider(id);
  }
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
