import { describe, expect, it } from 'vitest';
import { MODEL_PRICING, PROVIDER_MODELS, resolveModelPrice } from './models';

describe('MODEL_PRICING', () => {
  it('has a default price for every model in PROVIDER_MODELS', () => {
    const known = Object.values(PROVIDER_MODELS).flat();
    for (const model of known) {
      expect(MODEL_PRICING[model], `missing default price for ${model}`).toBeDefined();
    }
  });
});

describe('resolveModelPrice', () => {
  it('returns the shipped default with source "default"', () => {
    expect(resolveModelPrice('claude-opus-4-8')).toEqual({
      inputPerM: 5,
      outputPerM: 25,
      source: 'default',
    });
  });

  it('prefers an override over the default and tags source "override"', () => {
    const resolved = resolveModelPrice('claude-opus-4-8', {
      'claude-opus-4-8': { inputPerM: 1, outputPerM: 2 },
    });
    expect(resolved).toEqual({ inputPerM: 1, outputPerM: 2, source: 'override' });
  });

  it('falls back to the default when the override map lacks the model', () => {
    const resolved = resolveModelPrice('claude-sonnet-4-6', {
      'claude-opus-4-8': { inputPerM: 1, outputPerM: 2 },
    });
    expect(resolved).toEqual({ inputPerM: 3, outputPerM: 15, source: 'default' });
  });

  it('returns null for a model with neither an override nor a default', () => {
    expect(resolveModelPrice('stub-model')).toBeNull();
    expect(resolveModelPrice('stub-model', {})).toBeNull();
  });
});
