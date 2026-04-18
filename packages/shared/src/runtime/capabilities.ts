import { z } from 'zod';

/** Static capability advertisement from a provider adapter. */
export const providerCapabilitiesSchema = z.object({
  models: z.array(z.string()),
  maxTokens: z.number().int().positive(),
  supportsMcp: z.boolean(),
});
export type ProviderCapabilities = z.infer<typeof providerCapabilitiesSchema>;
