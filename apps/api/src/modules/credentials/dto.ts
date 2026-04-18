import { z } from 'zod';
import { platformSchema } from '@conduit/shared';

export const createCredentialDtoSchema = z.object({
  platform: platformSchema,
  name: z.string().min(1).max(120),
  secret: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});
export type CreateCredentialDto = z.infer<typeof createCredentialDtoSchema>;

export const updateCredentialDtoSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  secret: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type UpdateCredentialDto = z.infer<typeof updateCredentialDtoSchema>;
