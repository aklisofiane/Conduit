import { z } from 'zod';
import { agentProviderIdSchema } from '@conduit/shared/agent';

export const createProviderConfigDtoSchema = z.object({
  providerId: agentProviderIdSchema,
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional(),
});
export type CreateProviderConfigDto = z.infer<typeof createProviderConfigDtoSchema>;

export const updateProviderConfigDtoSchema = z
  .object({
    apiKey: z.string().min(1).optional(),
    baseUrl: z.string().url().nullable().optional(),
  })
  .refine((v) => v.apiKey !== undefined || v.baseUrl !== undefined, {
    message: 'At least one of `apiKey` or `baseUrl` is required',
  });
export type UpdateProviderConfigDto = z.infer<typeof updateProviderConfigDtoSchema>;
