import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { listProjectBoards, type ProjectBoardSummary } from '@conduit/shared/platform';
import { CredentialsService } from '../credentials/credentials.service';
import type { ListProjectsDto } from './dto';

/**
 * Trigger-config-time helpers. Failures (bad token, missing scope, unknown
 * owner) surface as 400s so the user who just typed the wrong value sees
 * the message inline — same UX as `McpService.introspect`.
 */
@Injectable()
export class TriggerService {
  private readonly logger = new Logger(TriggerService.name);

  constructor(private readonly credentials: CredentialsService) {}

  async listProjects(
    workflowId: string,
    dto: ListProjectsDto,
  ): Promise<ProjectBoardSummary[]> {
    const token = await this.credentials.getConnectionToken(workflowId, dto.connectionId);

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
