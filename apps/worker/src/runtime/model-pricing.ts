import { type ModelPrice, toModelPrice } from '@conduit/shared/agent';
import { prisma } from './prisma';

/**
 * Load one per-org `ModelPrice` override as a `model -> { inputPerM,
 * outputPerM }` lookup, ready to pass as the `overrides` arg to
 * `resolveModelPrice`. Reads via Prisma and converts the `Decimal` columns to
 * plain numbers. Sparse — if this model has no override, it falls back to the
 * shipped `MODEL_PRICING` default inside `resolveModelPrice`. Returns an empty
 * record when the org has no override for this model.
 *
 * No caching in v1 — one read per agent activity is cheap (mirrors
 * `loadProviderConfig`) and avoids stale prices after an edit.
 */
export async function loadModelPricing(
  orgId: string,
  model: string,
): Promise<Record<string, ModelPrice>> {
  const row = await prisma().modelPrice.findUnique({
    where: { orgId_model: { orgId, model } },
  });
  if (!row) return {};

  return { [row.model]: toModelPrice(row) };
}
