import { z } from 'zod';
import { mcpTransportSchema } from '@conduit/shared';

/**
 * MCP introspection request — the UI hands us a transport config (with
 * credentials already resolved in-memory) and we return the server's
 * `tools/list` output for the `allowedTools` picker.
 */
export const introspectMcpDtoSchema = z.object({
  transport: mcpTransportSchema,
});
export type IntrospectMcpDto = z.infer<typeof introspectMcpDtoSchema>;
