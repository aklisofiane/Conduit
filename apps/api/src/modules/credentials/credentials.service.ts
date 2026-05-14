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
    // PAT-rotation of an OAuth-derived row converts it to a manual credential.
    // Strip `source` and `scopes` from existing metadata so the UI badge stops
    // claiming OAuth provenance once the secret is no longer the OAuth token.
    // Skipped if the caller already supplied `metadata` — caller intent wins.
    let metadataPatch: object | undefined = dto.metadata as unknown as object | undefined;
    if (dto.secret !== undefined && metadataPatch === undefined) {
      const existing = await this.prisma.credential.findFirst({
        where: { id, orgId },
        select: { metadata: true },
      });
      const existingMeta = (existing?.metadata ?? null) as Record<string, unknown> | null;
      if (existingMeta && existingMeta.source === 'oauth') {
        const { source: _s, scopes: _sc, ...rest } = existingMeta;
        metadataPatch = rest;
      }
    }
    // updateMany lets us scope the write by orgId in one round-trip; a
    // cross-org id returns 404 with no row leak (matches the contract used
    // in WorkflowsService.update).
    const result = await this.prisma.credential.updateMany({
      where: { id, orgId },
      data: {
        name: dto.name,
        secret: dto.secret !== undefined ? encrypt(dto.secret) : undefined,
        metadata: metadataPatch,
      },
    });
    if (result.count === 0) {
      throw new NotFoundException(`Credential ${id} not found`);
    }
    return this.prisma.credential.findUniqueOrThrow({
      where: { id },
      select: { id: true, name: true, platform: true, updatedAt: true },
    });
  }

  /**
   * Mirror a Better Auth GitHub OAuth account into a Conduit `Credential`.
   * Server-trusted: caller (Better Auth `account.*.after` hook) has already
   * resolved `orgId` from the user id. Idempotent on `accountRowId` — the
   * Better Auth `account.id` is unique, so re-sign-in updates `secret` +
   * `metadata.scopes` in place rather than creating duplicates.
   */
  async upsertOAuthDerived(params: {
    orgId: string;
    accountRowId: string;
    githubAccountId: string;
    githubLogin: string;
    accessToken: string;
    scopes: string[];
  }): Promise<{ id: string; created: boolean }> {
    const { orgId, accountRowId, githubAccountId, githubLogin, accessToken, scopes } = params;
    const encryptedSecret = encrypt(accessToken);
    const metadata = {
      source: 'oauth' as const,
      accountRowId,
      githubAccountId,
      githubLogin,
      scopes,
    };
    const existing = await this.prisma.credential.findFirst({
      where: {
        orgId,
        platform: 'GITHUB',
        metadata: { path: ['accountRowId'], equals: accountRowId },
      },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.credential.update({
        where: { id: existing.id },
        data: { secret: encryptedSecret, metadata },
      });
      return { id: existing.id, created: false };
    }
    const created = await this.prisma.credential.create({
      data: {
        orgId,
        platform: 'GITHUB',
        name: `${githubLogin} (oauth)`,
        secret: encryptedSecret,
        metadata,
      },
    });
    return { id: created.id, created: true };
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
   * Throws 404 for cross-org / missing ids so we don't leak existence.
   */
  async decryptForOrgCredential(orgId: string, credentialId: string): Promise<string> {
    const cred = await this.prisma.credential.findFirst({
      where: { id: credentialId, orgId },
      select: { secret: true },
    });
    if (!cred) throw new NotFoundException(`Credential ${credentialId} not found`);
    return decrypt(cred.secret);
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
