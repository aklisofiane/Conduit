import { z } from 'zod';

/**
 * Per-workflow connection — binds an alias to a `PlatformCredential` plus
 * optional platform bindings (owner/repo) and an optional webhook signing
 * secret. Webhook secret is encrypted server-side before persist; clients
 * send it in plaintext over TLS exactly once.
 */
export const createConnectionDtoSchema = z.object({
  alias: z.string().min(1).max(60),
  credentialId: z.string().min(1),
  owner: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  webhookSecret: z.string().min(1).optional(),
});
export type CreateConnectionDto = z.infer<typeof createConnectionDtoSchema>;

export const updateConnectionDtoSchema = z.object({
  alias: z.string().min(1).max(60).optional(),
  credentialId: z.string().min(1).optional(),
  owner: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  // Pass empty string to clear the webhook secret, omit to leave unchanged.
  webhookSecret: z.string().optional(),
});
export type UpdateConnectionDto = z.infer<typeof updateConnectionDtoSchema>;
