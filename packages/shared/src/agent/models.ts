import type { AgentProviderId } from './provider';

/**
 * Curated set of models exposed by each provider in the canvas dropdown and
 * advertised by `AgentProvider.getCapabilities()`. Ordered newest → oldest so
 * the freshest options surface first.
 *
 * The `model` string is a passthrough to the underlying SDK — the providers
 * don't enforce membership in this list at runtime. Adding a new entry is the
 * one edit needed to expose it everywhere.
 *
 * The Codex list is what the OpenAI Codex SDK accepts when authed via ChatGPT
 * OAuth (the default for Conduit deployments without an OPENAI_API_KEY). The
 * full v5 catalog is larger but most variants 400 with "model not supported
 * when using Codex with a ChatGPT account" — verified empirically.
 */
export const PROVIDER_MODELS: Record<AgentProviderId, readonly string[]> = {
  claude: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  codex: ['gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex', 'gpt-5.2'],
};

/** Model assigned to a freshly created agent node, per provider. */
export const DEFAULT_MODEL: Record<AgentProviderId, string> = {
  claude: 'claude-opus-4-6',
  codex: 'gpt-5.3-codex',
};
