import { z } from 'zod';
import { resolvedMcpServerSchema } from '../mcp/index';
import { agentConstraintsSchema } from '../agent/index';

/**
 * Provider-facing session setup. Populated by `runAgentNode` after workspace
 * resolution, skill copy-in, and MCP credential substitution. The per-turn
 * user message is passed later to `AgentSession.run(userMessage)`, so the
 * same session can be driven through multiple turns (main work, then the
 * final `.conduit/<NodeName>.md` summary prompt).
 */
export const agentRequestSchema = z.object({
  model: z.string().min(1),
  systemPrompt: z.string(),
  mcpServers: z.array(resolvedMcpServerSchema),
  workspacePath: z.string().min(1),
  /**
   * Extra absolute paths the agent is allowed to read/list outside its
   * `workspacePath`. Provider-specific: Claude Code wires this to the SDK's
   * `additionalDirectories` option; Codex/Stub ignore it.
   */
  additionalDirectories: z.array(z.string()).optional(),
  /**
   * Enable the provider's built-in web search/fetch capability for this
   * session. Claude wires this to the SDK's `disallowedTools` option (off
   * means WebSearch/WebFetch are removed from context); Codex wires it to
   * `webSearchEnabled` on `ThreadOptions`. Stub ignores it.
   */
  webSearch: z.boolean().default(false),
  constraints: agentConstraintsSchema,
});
export type AgentRequest = z.infer<typeof agentRequestSchema>;
