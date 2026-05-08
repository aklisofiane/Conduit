import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { ConnectionScopeKind, Platform } from '@conduit/shared';
import { OrgId } from '../../auth/org-id.decorator';
import { SessionGuard } from '../../auth/session.guard';
import { ZodBodyPipe } from '../../common/zod-body.pipe';
import { ConnectionsService } from './connections.service';
import {
  type CreateConnectionDto,
  type UpdateConnectionDto,
  createConnectionDtoSchema,
  updateConnectionDtoSchema,
} from './dto';

const VALID_PLATFORMS = new Set<Platform>([
  'GITHUB',
  'GITLAB',
  'JIRA',
  'SLACK',
  'DISCORD',
]);

const VALID_SCOPE_KINDS = new Set<ConnectionScopeKind>([
  'github_repo',
  'github_projects_v2',
  'none',
]);

/**
 * Global Connection CRUD. Connections aren't per-workflow anymore —
 * workflows reference them by id from inside `Workflow.definition` slots.
 */
@UseGuards(SessionGuard)
@Controller('connections')
export class ConnectionsController {
  constructor(private readonly svc: ConnectionsService) {}

  @Get()
  list(
    @OrgId() orgId: string,
    @Query('platform') platform?: string,
    @Query('scopeKind') scopeKind?: string,
  ) {
    return this.svc.list(orgId, {
      platform: platform && VALID_PLATFORMS.has(platform as Platform)
        ? (platform as Platform)
        : undefined,
      scopeKind:
        scopeKind && VALID_SCOPE_KINDS.has(scopeKind as ConnectionScopeKind)
          ? (scopeKind as ConnectionScopeKind)
          : undefined,
    });
  }

  @Get(':id')
  get(@OrgId() orgId: string, @Param('id') id: string) {
    return this.svc.get(orgId, id);
  }

  @Post()
  create(
    @OrgId() orgId: string,
    @Body(new ZodBodyPipe(createConnectionDtoSchema)) dto: CreateConnectionDto,
  ) {
    return this.svc.create(orgId, dto);
  }

  @Patch(':id')
  update(
    @OrgId() orgId: string,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(updateConnectionDtoSchema)) dto: UpdateConnectionDto,
  ) {
    return this.svc.update(orgId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@OrgId() orgId: string, @Param('id') id: string) {
    await this.svc.delete(orgId, id);
  }
}
