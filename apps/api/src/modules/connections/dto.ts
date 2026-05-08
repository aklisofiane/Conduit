import { z } from 'zod';
import { connectionScopeSchema } from '@conduit/shared';

/**
 * Global Connection — binds a name to a `Credential` plus a typed `scope`
 * (e.g. a GitHub repo, a Projects v2 board). One Credential can back many
 * Connections; rotation flows through the underlying Credential row.
 */
export const createConnectionDtoSchema = z.object({
  credentialId: z.string().min(1),
  name: z.string().min(1).max(120),
  scope: connectionScopeSchema,
});
export type CreateConnectionDto = z.infer<typeof createConnectionDtoSchema>;

export const updateConnectionDtoSchema = z.object({
  credentialId: z.string().min(1).optional(),
  name: z.string().min(1).max(120).optional(),
  scope: connectionScopeSchema.optional(),
});
export type UpdateConnectionDto = z.infer<typeof updateConnectionDtoSchema>;
