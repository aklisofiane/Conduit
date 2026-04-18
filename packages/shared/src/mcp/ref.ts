import { z } from 'zod';

/**
 * Reference from an agent node to a workflow-level MCP server, with an
 * optional per-agent `allowedTools` filter (enforced by the provider SDK).
 */
export const mcpServerRefSchema = z.object({
  serverId: z.string().min(1),
  allowedTools: z.array(z.string()).optional(),
});
export type McpServerRef = z.infer<typeof mcpServerRefSchema>;
