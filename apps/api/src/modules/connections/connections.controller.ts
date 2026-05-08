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
import {
  connectionScopeSchema,
  platformSchema,
  type ConnectionScopeKind,
  type Platform,
} from '@conduit/shared';
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

const VALID_SCOPE_KINDS: ReadonlySet<ConnectionScopeKind> = new Set(
  connectionScopeSchema.options.map((o) => o.shape.kind.value),
);

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
      platform: parsePlatform(platform),
      scopeKind: parseScopeKind(scopeKind),
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

function parsePlatform(s?: string): Platform | undefined {
  if (!s) return undefined;
  const r = platformSchema.safeParse(s);
  return r.success ? r.data : undefined;
}

function parseScopeKind(s?: string): ConnectionScopeKind | undefined {
  if (s && VALID_SCOPE_KINDS.has(s as ConnectionScopeKind)) {
    return s as ConnectionScopeKind;
  }
  return undefined;
}
