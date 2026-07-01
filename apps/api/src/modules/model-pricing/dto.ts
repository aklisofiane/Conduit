import { z } from 'zod';

/**
 * Upsert body for a per-org per-model price override. Keyed on `model`
 * (e.g. `claude-opus-4-8`) — the unique `(orgId, model)` constraint makes the
 * write idempotent. Rates are USD per 1M tokens; non-negative, matching the
 * `Decimal(12, 6)` columns. Blank = no override (the UI deletes instead).
 */
export const upsertModelPriceDtoSchema = z.object({
  model: z.string().min(1),
  inputPerM: z.number().nonnegative(),
  outputPerM: z.number().nonnegative(),
});
export type UpsertModelPriceDto = z.infer<typeof upsertModelPriceDtoSchema>;
