import type { AgentProviderId } from '@conduit/shared';
import { ClaudeProvider } from './claude-provider';
import { CodexProvider } from './codex-provider';
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
  opts: { anthropicApiKey?: string; openaiApiKey?: string } = {},
): AgentProvider {
  if (process.env.CONDUIT_PROVIDER === 'stub') {
    return new StubProvider(id);
  }
  switch (id) {
    case 'claude':
      return new ClaudeProvider({ apiKey: opts.anthropicApiKey });
    case 'codex':
      return new CodexProvider({ apiKey: opts.openaiApiKey });
    default: {
      const _exhaustive: never = id;
      throw new Error(`Unknown provider: ${String(_exhaustive)}`);
    }
  }
}
