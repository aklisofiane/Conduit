import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { DiscoveredTool } from '@conduit/shared';
import {
  introspectMcpServer,
  McpIntrospectionError,
  substituteCredentialInTransport,
} from '@conduit/agent';
import { PrismaService } from '../../common/prisma.service';
import { decrypt } from '../credentials/crypto';
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

  constructor(private readonly prisma: PrismaService) {}

  async introspect(dto: IntrospectMcpDto): Promise<DiscoveredTool[]> {
    const transport = await this.substituteCredential(dto);
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

  private async substituteCredential(dto: IntrospectMcpDto) {
    if (!dto.connectionId) return dto.transport;
    const conn = await this.prisma.workflowConnection.findUnique({
      where: { id: dto.connectionId },
      include: { credential: true },
    });
    if (!conn || (dto.workflowId && conn.workflowId !== dto.workflowId)) {
      throw new BadRequestException(
        `Connection ${dto.connectionId} not found${dto.workflowId ? ` on workflow ${dto.workflowId}` : ''}`,
      );
    }
    return substituteCredentialInTransport(dto.transport, decrypt(conn.credential.secret));
  }
}
