import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { expectScopeKind } from '@conduit/shared';
import {
  listProjectBoards,
  listViewerRepositories,
  listViewerOrganizations,
  listRepoLabels,
  listGitlabProjectLabels,
  listAccessibleGitlabProjects,
  type ProjectBoardSummary,
  type RepositorySummary,
  type ViewerOrgEntry,
  type GitlabProjectSummary,
  type RepoLabel,
} from '@conduit/shared/platform';
import { errMessage } from '../../common/err-message';
import { ConnectionsService } from '../connections/connections.service';
import { CredentialsService } from '../credentials/credentials.service';
import type { ListLabelsDto, ListProjectsDto, ListViewerReposDto, ListViewerOrgsDto } from './dto';

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

  async listViewerRepos(
    orgId: string,
    dto: ListViewerReposDto,
  ): Promise<RepositorySummary[] | GitlabProjectSummary[]> {
    const { token, platform, hostUrl } = await this.resolveCredentialInfo(
      orgId,
      dto.credentialId,
    );

    try {
      if (platform === 'GITLAB') {
        return await listAccessibleGitlabProjects({
          hostUrl: hostUrl ?? 'gitlab.com',
          token,
        });
      }
      return await listViewerRepositories(token);
    } catch (e: unknown) {
      const message = errMessage(e);
      this.logger.warn(`List viewer repos failed (${platform}): ${message}`);
      throw new BadRequestException({ message });
    }
  }

  async listViewerOrgs(
    orgId: string,
    dto: ListViewerOrgsDto,
  ): Promise<ViewerOrgEntry[]> {
    const { token } = await this.resolveCredentialInfo(orgId, dto.credentialId);

    try {
      return await listViewerOrganizations(token);
    } catch (e: unknown) {
      const message = errMessage(e);
      this.logger.warn(`List viewer orgs failed: ${message}`);
      throw new BadRequestException({ message });
    }
  }

  private async resolveCredentialInfo(
    orgId: string,
    credentialId: string,
  ): Promise<{ token: string; platform: string; hostUrl: string | null }> {
    const [token, info] = await Promise.all([
      this.credentials.decryptForOrgCredential(orgId, credentialId),
      this.credentials.getOrgCredentialInfo(orgId, credentialId),
    ]);
    return { token, platform: info.platform, hostUrl: info.hostUrl };
  }

  private async resolveToken(orgId: string, dto: ListProjectsDto): Promise<string> {
    if (dto.connectionId) {
      const [, { token }] = await Promise.all([
        this.connections.assertInOrg(orgId, dto.connectionId),
        this.credentials.getConnectionBinding(dto.connectionId),
      ]);
      return token;
    }
    if (!dto.credentialId) {
      // The DTO's refine guarantees exactly one is set; this branch is unreachable.
      throw new BadRequestException('Missing connectionId or credentialId');
    }
    return this.credentials.decryptForOrgCredential(orgId, dto.credentialId);
  }

  async listLabels(orgId: string, dto: ListLabelsDto): Promise<RepoLabel[]> {
    const [, binding] = await Promise.all([
      this.connections.assertInOrg(orgId, dto.connectionId),
      this.credentials.getConnectionBinding(dto.connectionId),
    ]);

    if (binding.platform === 'GITLAB') {
      let glScope;
      try {
        glScope = expectScopeKind(binding.scope, 'gitlab_project');
      } catch {
        throw new BadRequestException({
          message: `Connection ${dto.connectionId} is not bound to a GitLab project (scope.kind = ${binding.scope.kind})`,
        });
      }
      try {
        return await listGitlabProjectLabels({
          hostUrl: binding.hostUrl ?? 'gitlab.com',
          projectPath: glScope.projectPath,
          token: binding.token,
        });
      } catch (e: unknown) {
        const message = errMessage(e);
        this.logger.warn(
          `List GitLab labels failed (${glScope.projectPath}): ${message}`,
        );
        throw new BadRequestException({ message });
      }
    }

    // Default: GitHub (existing behavior).
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
