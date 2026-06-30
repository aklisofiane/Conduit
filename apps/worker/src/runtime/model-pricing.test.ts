import { describe, expect, it, vi } from 'vitest';
import { loadModelPricing } from './model-pricing';

/**
 * `loadModelPricing` maps the org's `ModelPrice` rows into the
 * `model -> { inputPerM, outputPerM }` lookup that `resolveModelPrice` takes
 * as its `overrides` arg, converting Prisma `Decimal` columns to numbers.
 * Only prisma is mocked.
 */

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('./prisma', () => ({
  prisma: () => ({ modelPrice: { findMany } }),
}));

describe('loadModelPricing', () => {
  it('maps rows to a {model: {inputPerM, outputPerM}} record, Decimal -> number', async () => {
    findMany.mockResolvedValue([
      // Prisma returns Decimal instances; Number(...) must coerce them.
      { model: 'claude-opus-4-8', inputPerM: { toString: () => '12.5' }, outputPerM: { toString: () => '60' } },
      { model: 'gpt-5.5', inputPerM: 1, outputPerM: 8 },
    ]);

    const overrides = await loadModelPricing('org_1');

    expect(findMany).toHaveBeenCalledWith({ where: { orgId: 'org_1' } });
    expect(overrides).toEqual({
      'claude-opus-4-8': { inputPerM: 12.5, outputPerM: 60 },
      'gpt-5.5': { inputPerM: 1, outputPerM: 8 },
    });
    expect(typeof overrides['claude-opus-4-8']?.inputPerM).toBe('number');
  });

  it('returns an empty record when the org has no overrides', async () => {
    findMany.mockResolvedValue([]);
    await expect(loadModelPricing('org_2')).resolves.toEqual({});
  });
});
