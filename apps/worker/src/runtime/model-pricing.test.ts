import { describe, expect, it, vi } from 'vitest';
import { loadModelPricing } from './model-pricing';

/**
 * `loadModelPricing` issues a single `findUnique` on the compound key
 * `(orgId, model)` and returns a 0-or-1-entry record for `resolveModelPrice`,
 * converting Prisma `Decimal` columns to plain JS numbers.
 * Only prisma is mocked.
 */

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock('./prisma', () => ({
  prisma: () => ({ modelPrice: { findUnique } }),
}));

describe('loadModelPricing', () => {
  it('returns a single-entry record and converts Decimal values to numbers', async () => {
    // Prisma returns Decimal instances; Number(...) must coerce them.
    findUnique.mockResolvedValue({
      model: 'claude-opus-4-8',
      inputPerM: { toString: () => '12.5' },
      outputPerM: { toString: () => '60' },
    });

    const overrides = await loadModelPricing('org_1', 'claude-opus-4-8');

    expect(findUnique).toHaveBeenCalledWith({
      where: { orgId_model: { orgId: 'org_1', model: 'claude-opus-4-8' } },
    });
    expect(overrides).toEqual({
      'claude-opus-4-8': { inputPerM: 12.5, outputPerM: 60 },
    });
    expect(typeof overrides['claude-opus-4-8']?.inputPerM).toBe('number');
    expect(typeof overrides['claude-opus-4-8']?.outputPerM).toBe('number');
  });

  it('returns an empty record when no override exists for the model', async () => {
    findUnique.mockResolvedValue(null);
    await expect(loadModelPricing('org_2', 'unknown-model')).resolves.toEqual({});
  });
});
