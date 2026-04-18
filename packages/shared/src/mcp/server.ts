import { z } from 'zod';
import { mcpTransportSchema } from './transport.js';
import { discoveredToolSchema } from './tool.js';

/**
 * MCP server declared at the workflow level and referenced by agent nodes.
 * `discoveredTools` is cached from the last `POST /api/mcp/introspect` call
 * so the UI can render `allowedTools` pickers without re-introspecting.
 */
export const workflowMcpServerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  transport: mcpTransportSchema,
  connectionId: z.string().optional(),
  discoveredTools: z.array(discoveredToolSchema).optional(),
});
export type WorkflowMcpServer = z.infer<typeof workflowMcpServerSchema>;

/**
 * MCP server config with credentials already substituted — the shape handed
 * to the provider SDK at runtime. Produced by `runAgentNode` after decrypting
 * the linked `WorkflowConnection` secret and replacing `{{credential}}`
 * placeholders in `transport.env` / `transport.headers`.
 */
export const resolvedMcpServerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  transport: mcpTransportSchema,
  allowedTools: z.array(z.string()).optional(),
});
export type ResolvedMcpServer = z.infer<typeof resolvedMcpServerSchema>;
