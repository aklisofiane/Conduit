import type { ModelPrice } from '@conduit/shared/agent';
import { prisma } from './prisma';

/**
 * Load the per-org `ModelPrice` overrides as a `model -> { inputPerM,
 * outputPerM }` lookup, ready to pass as the `overrides` arg to
 * `resolveModelPrice`. Reads via Prisma and converts the `Decimal` columns to
 * plain numbers. Sparse — only models the org has explicitly overridden get a
 * key; everything else falls back to the shipped `MODEL_PRICING` default inside
 * `resolveModelPrice`. Returns an empty record when the org has no overrides.
 *
 * No caching in v1 — one read per agent activity is cheap (mirrors
 * `loadProviderConfig`) and avoids stale prices after an edit.
 */
export async function loadModelPricing(
  orgId: string,
): Promise<Record<string, ModelPrice>> {
  const rows = await prisma().modelPrice.findMany({ where: { orgId } });
  const out: Record<string, ModelPrice> = {};
  for (const row of rows) {
    out[row.model] = {
      inputPerM: Number(row.inputPerM),
      outputPerM: Number(row.outputPerM),
    };
  }
  return out;
}
