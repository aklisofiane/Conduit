import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { expectScopeKind } from '@conduit/shared';
import {
  listProjectBoards,
  listRepoLabels,
  type ProjectBoardSummary,
  type RepoLabel,
} from '@conduit/shared/platform';
import { PrismaService } from '../../common/prisma.service';
import { CredentialsService } from '../credentials/credentials.service';
import type { ListLabelsDto, ListProjectsDto } from './dto';

/**
 * Trigger-config-time helpers. Failures (bad token, missing scope, unknown
 * owner) surface as 400s so the user who just typed the wrong value sees
 * the message inline — same UX as `McpService.introspect`.
 *
 * Org-scoped: the connection id has to belong to the active org or we 404
 * before resolving credentials, so a client can't probe sibling orgs by id.
 */
@Injectable()
export class TriggerService {
  private readonly logger = new Logger(TriggerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
  ) {}

  async listProjects(orgId: string, dto: ListProjectsDto): Promise<ProjectBoardSummary[]> {
    await this.assertConnectionInOrg(orgId, dto.connectionId);
    const { token } = await this.credentials.getConnectionBinding(dto.connectionId);

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

  async listLabels(orgId: string, dto: ListLabelsDto): Promise<RepoLabel[]> {
    await this.assertConnectionInOrg(orgId, dto.connectionId);
    const binding = await this.credentials.getConnectionBinding(dto.connectionId);
    let repoScope;
    try {
      repoScope = expectScopeKind(binding.scope, 'github_repo');
    } catch {
      throw new BadRequestException({
        message: `Connection ${dto.connectionId} is not bound to a GitHub repo (scope.kind = ${binding.scope.kind})`,
      });
    }
    try {
      return await listRepoLabels({
        owner: repoScope.owner,
        repo: repoScope.repo,
        token: binding.token,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `List labels failed (${repoScope.owner}/${repoScope.repo}): ${message}`,
      );
      throw new BadRequestException({ message });
    }
  }

  private async assertConnectionInOrg(orgId: string, connectionId: string): Promise<void> {
    const conn = await this.prisma.connection.findFirst({
      where: { id: connectionId, orgId },
      select: { id: true },
    });
    if (!conn) throw new NotFoundException(`Connection ${connectionId} not found`);
  }
}
