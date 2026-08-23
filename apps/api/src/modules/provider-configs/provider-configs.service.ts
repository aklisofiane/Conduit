import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { encrypt, redactSafely } from '../credentials/crypto';
import type { CreateProviderConfigDto, UpdateProviderConfigDto } from './dto';

/**
 * Redacted row shape returned to the UI / API consumers. Never contains
 * plaintext — only the last four chars of the decrypted API key as a
 * display hint. See the spec's *API surface* section.
 */
export interface ProviderConfigRow {
  id: string;
  providerId: string;
  baseUrl: string | null;
  suffix: string;
  updatedAt: Date;
}

@Injectable()
export class ProviderConfigsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(orgId: string): Promise<ProviderConfigRow[]> {
    const rows = await this.prisma.providerConfig.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toRow);
  }

  /**
   * Upsert on `(orgId, providerId)`. The unique constraint guarantees at
   * most one row per provider per org — re-POSTing the same `providerId`
   * atomically replaces the key + base URL.
   */
  async create(orgId: string, dto: CreateProviderConfigDto): Promise<ProviderConfigRow> {
    const row = await this.prisma.providerConfig.upsert({
      where: { orgId_providerId: { orgId, providerId: dto.providerId } },
      create: {
        orgId,
        providerId: dto.providerId,
        encryptedApiKey: encrypt(dto.apiKey),
        baseUrl: dto.baseUrl ?? null,
      },
      update: {
        encryptedApiKey: encrypt(dto.apiKey),
        baseUrl: dto.baseUrl ?? null,
      },
    });
    return toRow(row);
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateProviderConfigDto,
  ): Promise<ProviderConfigRow> {
    // updateMany scopes the write by orgId so a cross-org id returns 404
    // with no row leak — same contract as WorkflowsService.update.
    const result = await this.prisma.providerConfig.updateMany({
      where: { id, orgId },
      data: {
        encryptedApiKey: dto.apiKey !== undefined ? encrypt(dto.apiKey) : undefined,
        baseUrl: dto.baseUrl === undefined ? undefined : dto.baseUrl,
      },
    });
    if (result.count === 0) {
      throw new NotFoundException(`ProviderConfig ${id} not found`);
    }
    const row = await this.prisma.providerConfig.findUniqueOrThrow({
      where: { id },
    });
    return toRow(row);
  }

  async delete(orgId: string, id: string): Promise<void> {
    const result = await this.prisma.providerConfig.deleteMany({
      where: { id, orgId },
    });
    if (result.count === 0) {
      throw new NotFoundException(`ProviderConfig ${id} not found`);
    }
  }
}

function toRow(row: {
  id: string;
  providerId: string;
  encryptedApiKey: string;
  baseUrl: string | null;
  updatedAt: Date;
}): ProviderConfigRow {
  return {
    id: row.id,
    providerId: row.providerId,
    baseUrl: row.baseUrl,
    suffix: redactSafely(row.encryptedApiKey),
    updatedAt: row.updatedAt,
  };
}
