import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import type { CreateCredentialDto, UpdateCredentialDto } from './dto';
import { decrypt, encrypt, redactedSuffix } from './crypto';

@Injectable()
export class CredentialsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const creds = await this.prisma.platformCredential.findMany({
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

  async create(dto: CreateCredentialDto) {
    const created = await this.prisma.platformCredential.create({
      data: {
        platform: dto.platform,
        name: dto.name,
        secret: encrypt(dto.secret),
        metadata: dto.metadata as unknown as object | undefined,
      },
    });
    return { id: created.id, platform: created.platform, name: created.name };
  }

  async update(id: string, dto: UpdateCredentialDto) {
    await this.findOrThrow(id);
    return this.prisma.platformCredential.update({
      where: { id },
      data: {
        name: dto.name,
        secret: dto.secret !== undefined ? encrypt(dto.secret) : undefined,
        metadata: dto.metadata as unknown as object | undefined,
      },
      select: { id: true, name: true, platform: true, updatedAt: true },
    });
  }

  async delete(id: string) {
    const cred = await this.findOrThrow(id);
    const inUse = await this.prisma.workflowConnection.count({ where: { credentialId: id } });
    if (inUse > 0) {
      throw new ConflictException(
        `Credential "${cred.name}" is used by ${inUse} connection(s) — delete them first`,
      );
    }
    await this.prisma.platformCredential.delete({ where: { id } });
  }

  /**
   * Looks up a credential by connection id and returns plaintext. Used at
   * agent-node runtime by the MCP config resolver — never by the public API.
   */
  async decryptForConnection(connectionId: string): Promise<string | undefined> {
    const conn = await this.prisma.workflowConnection.findUnique({
      where: { id: connectionId },
      include: { credential: true },
    });
    if (!conn) return undefined;
    return decrypt(conn.credential.secret);
  }

  /**
   * Like `decryptForConnection`, but rejects if the connection isn't on the
   * given workflow — used by config-time helpers exposed over the public API
   * so a user can only resolve tokens for connections they own.
   */
  async getConnectionToken(workflowId: string, connectionId: string): Promise<string> {
    const conn = await this.prisma.workflowConnection.findUnique({
      where: { id: connectionId },
      include: { credential: true },
    });
    if (!conn || conn.workflowId !== workflowId) {
      throw new NotFoundException(
        `Connection ${connectionId} not found on workflow ${workflowId}`,
      );
    }
    return decrypt(conn.credential.secret);
  }

  /**
   * Returns the connection's platform binding (owner/repo) along with its
   * decrypted token. Used by config-time helpers that need to call repo-
   * scoped GitHub APIs (e.g. listing labels) without re-asking the user for
   * fields already stored on the connection row.
   */
  async getConnectionBinding(
    workflowId: string,
    connectionId: string,
  ): Promise<{ owner: string | null; repo: string | null; token: string }> {
    const conn = await this.prisma.workflowConnection.findUnique({
      where: { id: connectionId },
      include: { credential: true },
    });
    if (!conn || conn.workflowId !== workflowId) {
      throw new NotFoundException(
        `Connection ${connectionId} not found on workflow ${workflowId}`,
      );
    }
    return {
      owner: conn.owner,
      repo: conn.repo,
      token: decrypt(conn.credential.secret),
    };
  }

  private async findOrThrow(id: string) {
    const cred = await this.prisma.platformCredential.findUnique({ where: { id } });
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
