import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { expectScopeKind } from '@conduit/shared';
import {
  listProjectBoards,
  listRepoLabels,
  type ProjectBoardSummary,
  type RepoLabel,
} from '@conduit/shared/platform';
import { errMessage } from '../../common/err-message';
import { ConnectionsService } from '../connections/connections.service';
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
    private readonly connections: ConnectionsService,
    private readonly credentials: CredentialsService,
  ) {}

  async listProjects(orgId: string, dto: ListProjectsDto): Promise<ProjectBoardSummary[]> {
    const token = await this.resolveToken(orgId, dto);

    try {
      return await listProjectBoards({
        ownerType: dto.ownerType,
        owner: dto.owner,
        token,
      });
    } catch (e: unknown) {
      const message = errMessage(e);
      this.logger.warn(
        `List Projects v2 failed (${dto.ownerType}/${dto.owner}): ${message}`,
      );
      throw new BadRequestException({ message });
    }
  }

  /**
   * Two token paths: an existing Connection (caller already picked one — used
   * by the trigger panel) or a raw Credential (settings preview before a
   * Connection is created). The DTO's `refine` already guarantees exactly one
   * is set, so the else-branch is safe.
   */
  private async resolveToken(orgId: string, dto: ListProjectsDto): Promise<string> {
    if (dto.connectionId) {
      const [, { token }] = await Promise.all([
        this.connections.assertInOrg(orgId, dto.connectionId),
        this.credentials.getConnectionBinding(dto.connectionId),
      ]);
      return token;
    }
    return this.credentials.decryptForOrgCredential(orgId, dto.credentialId!);
  }

  async listLabels(orgId: string, dto: ListLabelsDto): Promise<RepoLabel[]> {
    const [, binding] = await Promise.all([
      this.connections.assertInOrg(orgId, dto.connectionId),
      this.credentials.getConnectionBinding(dto.connectionId),
    ]);
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
      const message = errMessage(e);
      this.logger.warn(
        `List labels failed (${repoScope.owner}/${repoScope.repo}): ${message}`,
      );
      throw new BadRequestException({ message });
    }
  }
}
