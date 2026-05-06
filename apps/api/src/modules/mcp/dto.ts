import { z } from 'zod';
import { mcpTransportSchema } from '@conduit/shared';

/**
 * MCP introspection request. The UI hands us a transport config and, when
 * the server is bound to a workflow connection, the IDs needed to resolve
 * the `{{credential}}` placeholder. Without that resolution remote MCP
 * servers (e.g. https://api.githubcopilot.com/mcp/) reject `tools/list`
 * because the placeholder fails their `Authorization` format check. The
 * stdio path can also rely on this for env substitution.
 */
export const introspectMcpDtoSchema = z.object({
  transport: mcpTransportSchema,
  workflowId: z.string().min(1).optional(),
  connectionId: z.string().min(1).optional(),
});
export type IntrospectMcpDto = z.infer<typeof introspectMcpDtoSchema>;
