import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { connectionScopeSchema, type ConnectionScope } from '@conduit/shared';
import { PrismaService } from '../../common/prisma.service';
import type { CreateCredentialDto, UpdateCredentialDto } from './dto';
import { decrypt, encrypt, redactedSuffix } from './crypto';

@Injectable()
export class CredentialsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(orgId: string) {
    const creds = await this.prisma.credential.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { connections: true } },
      },
    });
    return creds.map((c) => ({
      id: c.id,
      platform: c.platform,
      name: c.name,
      metadata: c.metadata,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      connectionCount: c._count.connections,
      suffix: redactSafely(c.secret),
    }));
  }

  async create(orgId: string, dto: CreateCredentialDto) {
    const created = await this.prisma.credential.create({
      data: {
        orgId,
        platform: dto.platform,
        name: dto.name,
        secret: encrypt(dto.secret),
        metadata: dto.metadata as unknown as object | undefined,
      },
    });
    return { id: created.id, platform: created.platform, name: created.name };
  }

  async update(orgId: string, id: string, dto: UpdateCredentialDto) {
    await this.findOrThrow(orgId, id);
    return this.prisma.credential.update({
      where: { id },
      data: {
        name: dto.name,
        secret: dto.secret !== undefined ? encrypt(dto.secret) : undefined,
        metadata: dto.metadata as unknown as object | undefined,
      },
      select: { id: true, name: true, platform: true, updatedAt: true },
    });
  }

  async delete(orgId: string, id: string) {
    const cred = await this.findOrThrow(orgId, id);
    const inUse = await this.prisma.connection.count({ where: { credentialId: id } });
    if (inUse > 0) {
      throw new ConflictException(
        `Credential "${cred.name}" is used by ${inUse} connection(s) — delete them first`,
      );
    }
    await this.prisma.credential.delete({ where: { id } });
  }

  /**
   * Looks up a credential by connection id and returns plaintext. Used at
   * agent-node runtime by the MCP config resolver — never by the public API.
   * Server-trusted: callers (worker, config helpers) have already authorized
   * via the run row, so no `orgId` filter here.
   */
  async decryptForConnection(connectionId: string): Promise<string | undefined> {
    const conn = await this.prisma.connection.findUnique({
      where: { id: connectionId },
      include: { credential: true },
    });
    if (!conn) return undefined;
    return decrypt(conn.credential.secret);
  }

  /**
   * Returns the connection's parsed scope along with its decrypted token.
   * Server-trusted (called from worker / config-time helpers that already
   * authorized against the workflow row); not `orgId`-scoped.
   */
  async getConnectionBinding(
    connectionId: string,
  ): Promise<{ scope: ConnectionScope; token: string }> {
    const conn = await this.prisma.connection.findUnique({
      where: { id: connectionId },
      include: { credential: true },
    });
    if (!conn) {
      throw new NotFoundException(`Connection ${connectionId} not found`);
    }
    const scope = connectionScopeSchema.parse(conn.scope);
    return {
      scope,
      token: decrypt(conn.credential.secret),
    };
  }

  private async findOrThrow(orgId: string, id: string) {
    const cred = await this.prisma.credential.findFirst({ where: { id, orgId } });
    if (!cred) throw new NotFoundException(`Credential ${id} not found`);
    return cred;
  }
}

function redactSafely(encrypted: string): string {
  try {
    return redactedSuffix(decrypt(encrypted));
  } catch {
    return '****';
  }
}
