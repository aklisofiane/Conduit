import { z } from 'zod';
import type { AgentProviderId } from './provider';

/**
 * Reasoning-effort level forwarded to the provider SDK. The union is the
 * superset of both providers; `PROVIDER_EFFORT_LEVELS` narrows it to the
 * values each SDK actually accepts:
 *
 *   - Claude Agent SDK `query({ options.effort })`:  low | medium | high | xhigh | max
 *   - Codex SDK `startThread({ modelReasoningEffort })`: minimal | low | medium | high | xhigh
 *
 * The field is **optional** end-to-end. Left unset, neither SDK option is
 * forwarded and each provider applies its own default (Claude defaults to
 * `high`). Optional matters because not every model supports the effort
 * parameter — Claude silently downgrades on models that don't, so "let the
 * SDK decide" is a real, distinct state from any explicit level.
 */
export const effortLevelSchema = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
export type EffortLevel = z.infer<typeof effortLevelSchema>;

/**
 * Per-provider valid levels — the UI filters the effort dropdown by this map
 * and clamps on provider switch, exactly as it does for `PROVIDER_MODELS`.
 */
export const PROVIDER_EFFORT_LEVELS: Record<AgentProviderId, readonly EffortLevel[]> = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['minimal', 'low', 'medium', 'high', 'xhigh'],
};
