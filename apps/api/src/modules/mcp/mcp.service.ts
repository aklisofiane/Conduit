import { Injectable, Logger } from '@nestjs/common';
import type { DiscoveredTool, McpTransport } from '@conduit/shared';

/**
 * MCP introspection. Full implementation (stdio/SSE/HTTP client via
 * `@modelcontextprotocol/sdk`) lands in Phase 2 — see docs/PLANS.md. Phase
 * 1 ships the endpoint shape so the UI can wire it up and returns an empty
 * tool list with a warning-level log message.
 */
@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  async introspect(transport: McpTransport): Promise<DiscoveredTool[]> {
    this.logger.warn(
      `MCP introspection is a Phase 2 deliverable — returning empty tool list for transport.kind=${transport.kind}`,
    );
    return [];
  }
}
