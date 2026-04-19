import type {
  AgentConfig,
  McpServerRef,
  McpTransport,
  ResolvedMcpServer,
  WorkflowMcpServer,
} from '@conduit/shared';
import { CREDENTIAL_PLACEHOLDER_VALUE } from '@conduit/shared';
import { ValidationError } from '../errors/index';

/**
 * Credential secret looked up by connectionId. Plaintext lives in memory
 * only for the duration of this call — never logged, never persisted.
 */
export type CredentialLookup = (connectionId: string) => Promise<string | undefined>;

/**
 * Placeholder substituted in env/headers at resolution time.
 *
 * @deprecated import `CREDENTIAL_PLACEHOLDER_VALUE` from `@conduit/shared`.
 *             Kept as a re-export so existing callers don't break.
 */
export const CREDENTIAL_PLACEHOLDER = CREDENTIAL_PLACEHOLDER_VALUE;

/**
 * Resolves the MCP servers attached to an agent node into fully-substituted
 * configs ready to hand to the provider SDK. Steps:
 *
 *   1. For each `agent.mcpServers[]` ref, find the matching workflow-level
 *      `WorkflowMcpServer` definition.
 *   2. If the definition has a `connectionId`, look up + decrypt the secret
 *      and substitute `{{credential}}` in `transport.env` / `transport.headers`.
 *   3. Carry `allowedTools` from the ref (SDK enforces it).
 */
export async function resolveMcpServers(
  agent: Pick<AgentConfig, 'mcpServers'>,
  workflowServers: WorkflowMcpServer[],
  lookup: CredentialLookup,
): Promise<ResolvedMcpServer[]> {
  const byId = new Map(workflowServers.map((s) => [s.id, s]));
  const resolved: ResolvedMcpServer[] = [];
  for (const ref of agent.mcpServers) {
    const def = byId.get(ref.serverId);
    if (!def) {
      throw new ValidationError(
        `Agent references unknown MCP server "${ref.serverId}" — not declared at workflow level`,
      );
    }
    resolved.push(await resolveSingle(ref, def, lookup));
  }
  return resolved;
}

async function resolveSingle(
  ref: McpServerRef,
  def: WorkflowMcpServer,
  lookup: CredentialLookup,
): Promise<ResolvedMcpServer> {
  const secret = def.connectionId ? await lookup(def.connectionId) : undefined;
  if (def.connectionId && secret === undefined) {
    throw new ValidationError(
      `MCP server "${def.id}" binds connection ${def.connectionId} but no credential was resolved`,
    );
  }
  return {
    id: def.id,
    name: def.name,
    transport: substitute(def.transport, secret),
    allowedTools: ref.allowedTools,
  };
}

function substitute(transport: McpTransport, secret: string | undefined): McpTransport {
  if (secret === undefined) return transport;
  const replace = (v: string): string => v.split(CREDENTIAL_PLACEHOLDER).join(secret);
  if (transport.kind === 'stdio') {
    return {
      ...transport,
      env: transport.env ? mapValues(transport.env, replace) : transport.env,
    };
  }
  return {
    ...transport,
    headers: transport.headers ? mapValues(transport.headers, replace) : transport.headers,
  };
}

function mapValues(o: Record<string, string>, f: (v: string) => string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) out[k] = f(v);
  return out;
}
