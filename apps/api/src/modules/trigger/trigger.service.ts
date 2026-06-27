import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { expectScopeKind } from '@conduit/shared';
import type { ConnectionScope, ConnectionScopeKind } from '@conduit/shared';
import {
  listProjectBoards,
  listViewerRepositories,
  listViewerOrganizations,
  listRepoLabels,
  createRepoLabel,
  listGitlabProjectLabels,
  createGitlabProjectLabel,
  listRepoBranches,
  listGitlabProjectBranches,
  listAccessibleGitlabProjects,
  type ProjectBoardSummary,
  type RepositorySummary,
  type ViewerOrgEntry,
  type GitlabProjectSummary,
  type RepoLabel,
} from '@conduit/shared/platform';
import { getConduitLabel, type EnsureLabelResult } from '@conduit/shared/label';
import { errMessage } from '../../common/err-message';
import { ConnectionsService } from '../connections/connections.service';
import { CredentialsService } from '../credentials/credentials.service';
import type {
  EnsureLabelsDto,
  ListBranchesDto,
  ListLabelsDto,
  ListProjectsDto,
  ListViewerReposDto,
  ListViewerOrgsDto,
} from './dto';

/**
 * Color/description fall back to a neutral gray for names not in the registry,
 * so the endpoint stays usable even if a caller passes a non-canonical name.
 */
const FALLBACK_COLOR = 'ededed';

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
    const { token, platform } = await this.resolveCredentialInfo(
      orgId,
      dto.credentialId,
    );

    if (platform === 'GITLAB') return [];

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
    const info = await this.credentials.getOrgCredentialInfo(orgId, credentialId);
    const token = await this.credentials.decryptForOrgCredential(orgId, credentialId);
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
      const glScope = this.expectScopeOr400(
        binding.scope,
        'gitlab_project',
        dto.connectionId,
        'GitLab project',
      );
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
    const repoScope = this.expectScopeOr400(
      binding.scope,
      'github_repo',
      dto.connectionId,
      'GitHub repo',
    );
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

  /**
   * List the remote branch names on a connection's repo/project. Resolves the
   * binding/scope exactly like `listLabels` and branches GitHub vs GitLab on
   * `binding.platform`; a scope that isn't a repo/project is a
   * `BadRequestException`. Powers the cron trigger's branch picker.
   */
  async listBranches(orgId: string, dto: ListBranchesDto): Promise<string[]> {
    const [, binding] = await Promise.all([
      this.connections.assertInOrg(orgId, dto.connectionId),
      this.credentials.getConnectionBinding(dto.connectionId),
    ]);

    if (binding.platform === 'GITLAB') {
      const glScope = this.expectScopeOr400(
        binding.scope,
        'gitlab_project',
        dto.connectionId,
        'GitLab project',
      );
      try {
        return await listGitlabProjectBranches({
          hostUrl: binding.hostUrl ?? 'gitlab.com',
          projectPath: glScope.projectPath,
          token: binding.token,
        });
      } catch (e: unknown) {
        const message = errMessage(e);
        this.logger.warn(
          `List GitLab branches failed (${glScope.projectPath}): ${message}`,
        );
        throw new BadRequestException({
          message: 'Failed to list branches from GitLab',
        });
      }
    }

    // Default: GitHub (existing behavior).
    const repoScope = this.expectScopeOr400(
      binding.scope,
      'github_repo',
      dto.connectionId,
      'GitHub repo',
    );
    try {
      return await listRepoBranches({
        owner: repoScope.owner,
        repo: repoScope.repo,
        token: binding.token,
      });
    } catch (e: unknown) {
      const message = errMessage(e);
      this.logger.warn(
        `List branches failed (${repoScope.owner}/${repoScope.repo}): ${message}`,
      );
      throw new BadRequestException({
        message: 'Failed to list branches from GitHub',
      });
    }
  }

  /**
   * Idempotently ensure each requested label exists on the connection's
   * repo/project. Resolves the binding/scope exactly like `listLabels` and
   * branches GitHub vs GitLab on `binding.platform`; a scope that isn't a
   * repo/project is a `BadRequestException` (same pattern as `listLabels`).
   *
   * Per-label failures (e.g. a read-only token) don't fail the whole call —
   * they surface as `{ status: 'failed', error }` so callers can show partial
   * success.
   */
  async ensureLabels(
    orgId: string,
    dto: EnsureLabelsDto,
  ): Promise<EnsureLabelResult[]> {
    const [, binding] = await Promise.all([
      this.connections.assertInOrg(orgId, dto.connectionId),
      this.credentials.getConnectionBinding(dto.connectionId),
    ]);

    if (binding.platform === 'GITLAB') {
      const glScope = this.expectScopeOr400(
        binding.scope,
        'gitlab_project',
        dto.connectionId,
        'GitLab project',
      );
      return this.ensureEach(dto.names, (name, { color, description }) =>
        createGitlabProjectLabel({
          hostUrl: binding.hostUrl ?? 'gitlab.com',
          projectPath: glScope.projectPath,
          token: binding.token,
          name,
          color,
          description,
        }),
      );
    }

    // Default: GitHub (mirrors listLabels).
    const repoScope = this.expectScopeOr400(
      binding.scope,
      'github_repo',
      dto.connectionId,
      'GitHub repo',
    );
    return this.ensureEach(dto.names, (name, { color, description }) =>
      createRepoLabel({
        owner: repoScope.owner,
        repo: repoScope.repo,
        token: binding.token,
        name,
        color,
        description,
      }),
    );
  }

  /**
   * Narrow `scope` to `kind`, re-raising `expectScopeKind`'s failure as the
   * 400 the trigger-config UI shows inline. Shared by `listLabels` and
   * `ensureLabels`, which both gate on a repo/project-bound connection.
   */
  private expectScopeOr400<K extends ConnectionScopeKind>(
    scope: ConnectionScope,
    kind: K,
    connectionId: string,
    noun: string,
  ): Extract<ConnectionScope, { kind: K }> {
    try {
      return expectScopeKind(scope, kind);
    } catch {
      throw new BadRequestException({
        message: `Connection ${connectionId} is not bound to a ${noun} (scope.kind = ${scope.kind})`,
      });
    }
  }

  private async ensureEach(
    names: string[],
    create: (
      name: string,
      spec: { color: string; description?: string },
    ) => Promise<'created' | 'exists'>,
  ): Promise<EnsureLabelResult[]> {
    // Labels are independent — fan out the platform calls concurrently. Each
    // catches its own failure, so Promise.all never rejects and order (which
    // the caller pairs back to the requested names) is preserved.
    return Promise.all(
      names.map(async (name): Promise<EnsureLabelResult> => {
        try {
          const status = await create(name, labelSpec(name));
          return { name, status };
        } catch (e: unknown) {
          const error = errMessage(e);
          this.logger.warn(`Ensure label "${name}" failed: ${error}`);
          return { name, status: 'failed', error };
        }
      }),
    );
  }
}

/** Registry color/description for a name, falling back to neutral gray. */
function labelSpec(name: string): { color: string; description?: string } {
  const entry = getConduitLabel(name);
  return entry
    ? { color: entry.color, description: entry.description }
    : { color: FALLBACK_COLOR };
}
