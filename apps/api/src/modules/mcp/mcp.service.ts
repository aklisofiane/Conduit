import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { DiscoveredTool, McpTransport } from '@conduit/shared';
import { introspectMcpServer, McpIntrospectionError } from '@conduit/agent';

/**
 * MCP introspection. Connects to the server with the provided transport,
 * calls `tools/list`, returns the discovered tools. Used at config time so
 * the UI can render an `allowedTools` picker. Errors surfaced as 400 so the
 * user who just typed a bad command / URL / credential sees it inline.
 */
@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  async introspect(transport: McpTransport): Promise<DiscoveredTool[]> {
    try {
      return await introspectMcpServer(transport);
    } catch (e: unknown) {
      if (e instanceof McpIntrospectionError) {
        this.logger.warn(`MCP introspection failed (${transport.kind}): ${e.message}`);
        throw new BadRequestException({ message: e.message, transportKind: transport.kind });
      }
      throw e;
    }
  }
}
