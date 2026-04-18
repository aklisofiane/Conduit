import { z } from 'zod';

/** Tool metadata returned by `tools/list` on an MCP server. */
export const discoveredToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  inputSchema: z.unknown().optional(),
});
export type DiscoveredTool = z.infer<typeof discoveredToolSchema>;
