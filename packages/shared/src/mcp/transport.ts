import { z } from 'zod';

/**
 * Transport configuration for an MCP server. Passed to the provider SDK
 * (Claude / Codex), which owns the process + connection lifecycle.
 *
 * - `stdio`           — spawn a child process, speak MCP over stdio.
 * - `sse`             — connect to a long-lived server-sent-events endpoint.
 * - `streamable-http` — streaming HTTP transport.
 */
export const mcpTransportSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('stdio'),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
  }),
  z.object({
    kind: z.literal('sse'),
    url: z.string().url(),
    headers: z.record(z.string()).optional(),
  }),
  z.object({
    kind: z.literal('streamable-http'),
    url: z.string().url(),
    headers: z.record(z.string()).optional(),
  }),
]);
export type McpTransport = z.infer<typeof mcpTransportSchema>;
