import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { listProjectBoards, type ProjectBoardSummary } from '@conduit/shared/platform';
import { PrismaService } from '../../common/prisma.service';
import { decrypt } from '../credentials/crypto';
import type { ListProjectsDto } from './dto';

/**
 * Trigger-config-time helpers. Today: list every Projects v2 board under
 * an org/user so the polling-trigger UI can render the project picker as
 * a dropdown sourced from GitHub instead of a free-text "type the number"
 * input. Failures (bad token, missing scope, unknown owner) surface as
 * 400s so the user who just typed the wrong value sees the message
 * inline — same UX as `McpService.introspect`.
 */
@Injectable()
export class TriggerService {
  private readonly logger = new Logger(TriggerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listProjects(
    workflowId: string,
    dto: ListProjectsDto,
  ): Promise<ProjectBoardSummary[]> {
    const connection = await this.prisma.workflowConnection.findUnique({
      where: { id: dto.connectionId },
      include: { credential: true },
    });
    if (!connection) {
      throw new NotFoundException(`Connection ${dto.connectionId} not found`);
    }
    if (connection.workflowId !== workflowId) {
      throw new NotFoundException(
        `Connection ${dto.connectionId} not found on workflow ${workflowId}`,
      );
    }

    const token = decrypt(connection.credential.secret);

    try {
      return await listProjectBoards({
        ownerType: dto.ownerType,
        owner: dto.owner,
        token,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `List Projects v2 failed (${dto.ownerType}/${dto.owner}): ${message}`,
      );
      throw new BadRequestException({ message });
    }
  }
}
