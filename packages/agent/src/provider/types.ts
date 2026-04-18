import type {
  AgentEvent,
  AgentProviderId,
  AgentRequest,
  ProviderCapabilities,
} from '@conduit/shared';

export type { AgentEvent, AgentRequest, ProviderCapabilities };

/**
 * Minimal adapter every agent provider implements. Adapters stay dumb:
 * translate `AgentRequest` + streaming SDK events into `AgentEvent`s.
 * Retries, MCP lifecycle, credential decryption all live upstream.
 */
export interface AgentProvider {
  readonly id: AgentProviderId;
  getCapabilities(): ProviderCapabilities;
  execute(req: AgentRequest, signal: AbortSignal): AsyncIterable<AgentEvent>;
}
