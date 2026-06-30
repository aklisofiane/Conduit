import type { AgentProviderId } from './provider';

/**
 * The Codex list is what the OpenAI Codex SDK accepts when authed via ChatGPT
 * OAuth (the default for Conduit deployments without an OPENAI_API_KEY). The
 * full v5 catalog is larger but most variants 400 with "model not supported
 * when using Codex with a ChatGPT account" — verified empirically.
 */
export const PROVIDER_MODELS: Record<AgentProviderId, readonly string[]> = {
  claude: ['claude-opus-4-8', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  codex: ['gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex', 'gpt-5.2'],
};

export const DEFAULT_MODEL: Record<AgentProviderId, string> = {
  claude: 'claude-opus-4-8',
  codex: 'gpt-5.3-codex',
};

export interface ModelPrice {
  /** USD per 1M input tokens. */
  inputPerM: number;
  /** USD per 1M output tokens. */
  outputPerM: number;
}

export interface ResolvedModelPrice extends ModelPrice {
  /** Whether the price came from a per-org override or the shipped default. */
  source: 'default' | 'override';
}

/**
 * Default USD price per 1M tokens for each known model, used as the fallback
 * when an org hasn't set a per-model override (see the `ModelPrice` table).
 * Two-rate (input/output) only — providers emit flat token counts, so cache /
 * reasoning breakdowns are out of scope (see .specs/token-cost-per-run.md).
 *
 * Values track current public list prices by tier: Claude Opus 4.x $5/$25,
 * Sonnet 4.6 $3/$15, Haiku 4.5 $1/$5; the GPT-5 / Codex family at the published
 * GPT-5 rate of $1.25/$10. These are the "default value right now" — orgs
 * override per-model in settings, and runs snapshot the resolved price at write
 * time.
 */
export const MODEL_PRICING: Record<string, ModelPrice> = {
  // Claude (Opus 4.x is $5/$25 — the older $15/$75 was Claude 3 Opus)
  'claude-opus-4-8': { inputPerM: 5, outputPerM: 25 },
  'claude-opus-4-6': { inputPerM: 5, outputPerM: 25 },
  'claude-sonnet-4-6': { inputPerM: 3, outputPerM: 15 },
  'claude-haiku-4-5': { inputPerM: 1, outputPerM: 5 },
  // Codex (GPT-5 family)
  'gpt-5.5': { inputPerM: 1.25, outputPerM: 10 },
  'gpt-5.4': { inputPerM: 1.25, outputPerM: 10 },
  'gpt-5.3-codex': { inputPerM: 1.25, outputPerM: 10 },
  'gpt-5.2': { inputPerM: 1.25, outputPerM: 10 },
};

/**
 * Resolve the price for a model: an org `overrides` entry wins over the shipped
 * `MODEL_PRICING` default, with `source` recording which was used. Returns
 * `null` for a model with neither an override nor a default (caller skips cost).
 */
export function resolveModelPrice(
  model: string,
  overrides?: Record<string, ModelPrice>,
): ResolvedModelPrice | null {
  const override = overrides?.[model];
  if (override) return { inputPerM: override.inputPerM, outputPerM: override.outputPerM, source: 'override' };
  const fallback = MODEL_PRICING[model];
  if (fallback) return { inputPerM: fallback.inputPerM, outputPerM: fallback.outputPerM, source: 'default' };
  return null;
}
