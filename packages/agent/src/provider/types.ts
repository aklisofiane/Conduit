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
 *
 * Sessions are multi-turn — `startSession` creates an SDK-backed thread
 * (Claude: streaming-input `query()`, Codex: `startThread()`, Stub: scripted
 * turn queue). Each `AgentSession.run(userMessage)` drives one turn to
 * completion. The caller is responsible for calling `dispose()` when done.
 */
export interface AgentProvider {
  readonly id: AgentProviderId;
  getCapabilities(): ProviderCapabilities;
  startSession(req: AgentRequest, signal: AbortSignal): AgentSession;
}

export interface AgentSession {
  /** Drive one turn. Yields events until the turn completes (provider emits `done`). */
  run(userMessage: string): AsyncIterable<AgentEvent>;
  /** Tear down the SDK session. Safe to call multiple times. */
  dispose(): Promise<void> | void;
}
