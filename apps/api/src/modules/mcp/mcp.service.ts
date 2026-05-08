import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { DiscoveredTool, McpTransport } from '@conduit/shared';
import {
  introspectMcpServer,
  McpIntrospectionError,
  substituteCredentialInTransport,
} from '@conduit/agent';
import { CredentialsService } from '../credentials/credentials.service';
import type { IntrospectMcpDto } from './dto';

/**
 * MCP introspection. Resolves the `{{credential}}` placeholder when the
 * caller passes a workflow + connection (the runtime resolver does the same
 * substitution at run time), then calls `tools/list` on the MCP server.
 * Errors surface as 400 so the user who just typed a bad command / URL /
 * credential sees the message inline.
 */
@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor(private readonly credentials: CredentialsService) {}

  async introspect(dto: IntrospectMcpDto): Promise<DiscoveredTool[]> {
    const transport = await this.resolveTransport(dto);
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

  private async resolveTransport(dto: IntrospectMcpDto): Promise<McpTransport> {
    if (!dto.connectionId) return dto.transport;
    const { token } = await this.credentials.getConnectionBinding(dto.connectionId);
    return substituteCredentialInTransport(dto.transport, token);
  }
}
