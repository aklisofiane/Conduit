import { z } from 'zod';
import { resolvedMcpServerSchema } from '../mcp/index';
import { agentConstraintsSchema } from '../agent/index';

/**
 * Provider-facing request. Populated by `runAgentNode` after workspace
 * resolution, skill copy-in, and MCP credential substitution.
 */
export const agentRequestSchema = z.object({
  model: z.string().min(1),
  systemPrompt: z.string(),
  userMessage: z.string(),
  mcpServers: z.array(resolvedMcpServerSchema),
  workspacePath: z.string().min(1),
  constraints: agentConstraintsSchema,
});
export type AgentRequest = z.infer<typeof agentRequestSchema>;
