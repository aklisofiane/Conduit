import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  connectionScopeSchema,
  type ConnectionScope,
  type ConnectionScopeKind,
  type Platform,
  type WorkflowDefinition,
} from '@conduit/shared';
import { PrismaService } from '../../common/prisma.service';
import type { CreateConnectionDto, UpdateConnectionDto } from './dto';

/** Shape returned by the list endpoint — safe to render directly in the UI. */
export interface ConnectionRow {
  id: string;
  name: string;
  credentialId: string;
  credential: { id: string; name: string; platform: Platform; hostUrl: string | null };
  scope: ConnectionScope;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListConnectionsFilter {
  platform?: Platform;
  scopeKind?: ConnectionScopeKind;
}

/**
 * CRUD over the global `Connection` table. Workflows reference connections
 * by id from inside the trigger / MCP server slots in `Workflow.definition`.
 */
@Injectable()
export class ConnectionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(orgId: string, filter: ListConnectionsFilter = {}): Promise<ConnectionRow[]> {
    const rows = await this.prisma.connection.findMany({
      where: {
        orgId,
        ...(filter.platform ? { credential: { platform: filter.platform } } : {}),
      },
      include: { credential: { select: { id: true, name: true, platform: true, hostUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const parsed = rows.map(toRow);
    if (filter.scopeKind) {
      return parsed.filter((r) => r.scope.kind === filter.scopeKind);
    }
    return parsed;
  }

  async get(orgId: string, id: string): Promise<ConnectionRow> {
    const row = await this.prisma.connection.findFirst({
      where: { id, orgId },
      include: { credential: { select: { id: true, name: true, platform: true, hostUrl: true } } },
    });
    if (!row) throw new NotFoundException(`Connection ${id} not found`);
    return toRow(row);
  }

  /**
   * Lightweight existence + org-scope check. Throws 404 (not 403) when the
   * connection isn't visible to this org so we never confirm the existence
   * of a sibling org's row by id.
   */
  async assertInOrg(orgId: string, id: string): Promise<void> {
    return this.findOrThrow(orgId, id);
  }

  async create(orgId: string, dto: CreateConnectionDto): Promise<ConnectionRow> {
    await this.ensureCredential(orgId, dto.credentialId);
    const created = await this.prisma.connection.create({
      data: {
        orgId,
        credentialId: dto.credentialId,
        name: dto.name,
        scope: dto.scope as unknown as object,
      },
      include: { credential: { select: { id: true, name: true, platform: true, hostUrl: true } } },
    });
    return toRow(created);
  }

  async update(orgId: string, id: string, dto: UpdateConnectionDto): Promise<ConnectionRow> {
    if (dto.credentialId) await this.ensureCredential(orgId, dto.credentialId);
    // updateMany scopes the write by orgId so a cross-org id returns 404
    // without leaking existence (same contract as WorkflowsService.update).
    const result = await this.prisma.connection.updateMany({
      where: { id, orgId },
      data: {
        credentialId: dto.credentialId,
        name: dto.name,
        scope: dto.scope ? (dto.scope as unknown as object) : undefined,
      },
    });
    if (result.count === 0) {
      throw new NotFoundException(`Connection ${id} not found`);
    }
    return this.get(orgId, id);
  }

  async delete(orgId: string, id: string): Promise<void> {
    await this.findOrThrow(orgId, id);
    const blockers = await this.findReferencingWorkflows(orgId, id);
    if (blockers.length > 0) {
      throw new ConflictException(
        `Connection ${id} is referenced by ${blockers.length} workflow(s): ` +
          blockers.map((b) => `"${b.name}"`).join(', '),
      );
    }
    await this.prisma.connection.delete({ where: { id } });
  }

  private async ensureCredential(orgId: string, id: string): Promise<void> {
    // Cross-org credential reference → 404, not 403 (per spec: don't confirm
    // existence of cross-org rows).
    const cred = await this.prisma.credential.findFirst({
      where: { id, orgId },
      select: { id: true },
    });
    if (!cred) throw new NotFoundException(`Credential ${id} not found`);
  }

  private async findOrThrow(orgId: string, id: string): Promise<void> {
    const row = await this.prisma.connection.findFirst({
      where: { id, orgId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException(`Connection ${id} not found`);
  }

  /**
   * Refuse to delete a Connection that's still referenced by any workflow's
   * trigger or MCP server. Loads every workflow's `definition` JSON and
   * scans the slots — fine at v1 scale; partition the search later if it
   * shows up in profiles. Scoped to the same org as the connection — a
   * sibling org couldn't legally reference this connection anyway, but the
   * filter avoids loading unrelated workflows.
   */
  private async findReferencingWorkflows(
    orgId: string,
    connectionId: string,
  ): Promise<{ id: string; name: string }[]> {
    const workflows = await this.prisma.workflow.findMany({
      where: { orgId },
      select: { id: true, name: true, definition: true },
    });
    const blockers: { id: string; name: string }[] = [];
    for (const wf of workflows) {
      const def = wf.definition as Partial<WorkflowDefinition> | null;
      if (!def) continue;
      const triggers = def.triggers ?? [];
      const triggerHit = triggers.some(
        (t) =>
          t?.connectionId === connectionId ||
          t?.boardConnectionId === connectionId,
      );
      const mcpHit = (def.mcpServers ?? []).some(
        (s) => s?.connectionId === connectionId,
      );
      if (triggerHit || mcpHit) {
        blockers.push({ id: wf.id, name: wf.name });
      }
    }
    return blockers;
  }
}

function toRow(row: {
  id: string;
  name: string;
  credentialId: string;
  scope: unknown;
  createdAt: Date;
  updatedAt: Date;
  credential: { id: string; name: string; platform: Platform; hostUrl: string | null };
}): ConnectionRow {
  return {
    id: row.id,
    name: row.name,
    credentialId: row.credentialId,
    credential: row.credential,
    scope: connectionScopeSchema.parse(row.scope),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
