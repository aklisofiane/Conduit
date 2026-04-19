import type { DiscoveredTool, McpTransport } from '@conduit/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export const DEFAULT_INTROSPECT_TIMEOUT_MS = 10_000;

export const INTROSPECT_CLIENT_INFO = {
  name: 'conduit-introspect',
  version: '0.0.0',
} as const;

/**
 * Raised when introspection fails to yield a tool list. Callers (the API
 * layer) translate this into a 4xx response so the UI can surface it to the
 * user who just entered the MCP config.
 */
export class McpIntrospectionError extends Error {
  override readonly name = 'McpIntrospectionError';
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
  }
}

export interface IntrospectOptions {
  /** Hard ceiling on how long connect + tools/list may take. */
  timeoutMs?: number;
}

/**
 * Connect to an MCP server, call `tools/list`, disconnect. Used at config
 * time so the UI can render `allowedTools` pickers. The credentials in
 * `transport.env` / `transport.headers` are already substituted by the UI.
 *
 * Never retries — the user just pressed a button, we want to fail fast and
 * show them the error.
 */
export async function introspectMcpServer(
  transport: McpTransport,
  opts: IntrospectOptions = {},
): Promise<DiscoveredTool[]> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_INTROSPECT_TIMEOUT_MS;
  const client = new Client(INTROSPECT_CLIENT_INFO, { capabilities: {} });
  const clientTransport = buildTransport(transport);
  try {
    await withTimeout(client.connect(clientTransport), timeoutMs, 'connect');
    const result = await withTimeout(client.listTools(), timeoutMs, 'tools/list');
    return result.tools.map(toDiscoveredTool);
  } catch (e) {
    throw wrap(e);
  } finally {
    // Close is best-effort; surfacing a close error over a real failure would
    // hide the root cause from the user.
    try {
      await client.close();
    } catch {
      // ignore
    }
  }
}

function buildTransport(transport: McpTransport): Transport {
  switch (transport.kind) {
    case 'stdio':
      return new StdioClientTransport({
        command: transport.command,
        args: transport.args,
        env: transport.env,
      });
    case 'sse':
      return new SSEClientTransport(new URL(transport.url), {
        requestInit: transport.headers ? { headers: transport.headers } : undefined,
      });
    case 'streamable-http':
      return new StreamableHTTPClientTransport(new URL(transport.url), {
        requestInit: transport.headers ? { headers: transport.headers } : undefined,
      });
    default: {
      const _exhaustive: never = transport;
      throw new McpIntrospectionError(`Unknown MCP transport kind: ${String(_exhaustive)}`);
    }
  }
}

function toDiscoveredTool(t: {
  name: string;
  description?: string;
  inputSchema?: unknown;
}): DiscoveredTool {
  return {
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  };
}

async function withTimeout<T>(p: Promise<T>, ms: number, phase: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new McpIntrospectionError(`MCP ${phase} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function wrap(e: unknown): McpIntrospectionError {
  if (e instanceof McpIntrospectionError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new McpIntrospectionError(`MCP introspection failed: ${msg}`, e);
}
