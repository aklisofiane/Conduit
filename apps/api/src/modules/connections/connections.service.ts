import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { encrypt, redactedSuffix, safeDecrypt } from '../credentials/crypto';
import type { CreateConnectionDto, UpdateConnectionDto } from './dto';

/** Shape returned by the list endpoint — safe to render directly in the UI. */
export interface ConnectionRow {
  id: string;
  workflowId: string;
  alias: string;
  credentialId: string;
  credential: { id: string; name: string; platform: string };
  owner: string | null;
  repo: string | null;
  hasWebhookSecret: boolean;
  webhookSecretSuffix: string | null;
}

/**
 * CRUD over `WorkflowConnection`. Webhook signing secrets are encrypted
 * with the same AES-256-GCM format as `PlatformCredential.secret` — one
 * crypto path in the codebase, no special case for webhooks.
 */
@Injectable()
export class ConnectionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workflowId: string): Promise<ConnectionRow[]> {
    await this.ensureWorkflow(workflowId);
    const rows = await this.prisma.workflowConnection.findMany({
      where: { workflowId },
      include: { credential: { select: { id: true, name: true, platform: true } } },
      orderBy: { alias: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      workflowId: r.workflowId,
      alias: r.alias,
      credentialId: r.credentialId,
      credential: r.credential,
      owner: r.owner,
      repo: r.repo,
      hasWebhookSecret: Boolean(r.webhookSecret),
      webhookSecretSuffix: r.webhookSecret ? suffixOf(r.webhookSecret) : null,
    }));
  }

  async create(workflowId: string, dto: CreateConnectionDto) {
    await this.ensureWorkflow(workflowId);
    await this.ensureCredential(dto.credentialId);

    try {
      const row = await this.prisma.workflowConnection.create({
        data: {
          workflowId,
          alias: dto.alias,
          credentialId: dto.credentialId,
          owner: dto.owner,
          repo: dto.repo,
          webhookSecret: dto.webhookSecret ? encrypt(dto.webhookSecret) : null,
        },
      });
      return { id: row.id, alias: row.alias, credentialId: row.credentialId };
    } catch (err) {
      if (isUniqueConstraint(err)) {
        throw new ConflictException(
          `Alias "${dto.alias}" is already used by another connection on this workflow`,
        );
      }
      throw err;
    }
  }

  async update(workflowId: string, connectionId: string, dto: UpdateConnectionDto) {
    await this.ensureInWorkflow(workflowId, connectionId);
    if (dto.credentialId) await this.ensureCredential(dto.credentialId);

    // Empty string → clear; undefined → leave alone; anything else → re-encrypt.
    let webhookSecret: string | null | undefined;
    if (dto.webhookSecret === undefined) webhookSecret = undefined;
    else if (dto.webhookSecret === '') webhookSecret = null;
    else webhookSecret = encrypt(dto.webhookSecret);

    try {
      return await this.prisma.workflowConnection.update({
        where: { id: connectionId },
        data: {
          alias: dto.alias,
          credentialId: dto.credentialId,
          owner: dto.owner,
          repo: dto.repo,
          webhookSecret,
        },
        select: { id: true, alias: true, credentialId: true },
      });
    } catch (err) {
      if (isUniqueConstraint(err)) {
        throw new ConflictException(
          `Alias "${dto.alias}" is already used by another connection on this workflow`,
        );
      }
      throw err;
    }
  }

  async delete(workflowId: string, connectionId: string) {
    await this.ensureInWorkflow(workflowId, connectionId);
    await this.prisma.workflowConnection.delete({ where: { id: connectionId } });
  }

  private async ensureWorkflow(id: string) {
    const wf = await this.prisma.workflow.findUnique({ where: { id }, select: { id: true } });
    if (!wf) throw new NotFoundException(`Workflow ${id} not found`);
  }

  private async ensureCredential(id: string) {
    const cred = await this.prisma.platformCredential.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!cred) throw new BadRequestException(`Credential ${id} does not exist`);
  }

  private async ensureInWorkflow(workflowId: string, connectionId: string) {
    const row = await this.prisma.workflowConnection.findUnique({
      where: { id: connectionId },
      select: { workflowId: true },
    });
    if (!row) throw new NotFoundException(`Connection ${connectionId} not found`);
    if (row.workflowId !== workflowId) {
      throw new NotFoundException(`Connection ${connectionId} not found on workflow ${workflowId}`);
    }
  }
}

function suffixOf(encrypted: string): string {
  const plain = safeDecrypt(encrypted);
  return plain ? redactedSuffix(plain) : '****';
}

function isUniqueConstraint(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'P2002'
  );
}
