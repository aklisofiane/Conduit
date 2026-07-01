import { Injectable, NotFoundException } from '@nestjs/common';
import { toModelPrice } from '@conduit/shared/agent';
import { PrismaService } from '../../common/prisma.service';
import type { UpsertModelPriceDto } from './dto';

/**
 * Row shape returned to the UI. The `Decimal(12, 6)` columns are converted to
 * plain numbers so the settings form can round-trip them as `<input>` values;
 * the worker's `loadModelPricing` uses the same shared conversion.
 */
export interface ModelPriceRow {
  model: string;
  inputPerM: number;
  outputPerM: number;
  updatedAt: Date;
}

@Injectable()
export class ModelPricingService {
  constructor(private readonly prisma: PrismaService) {}

  async list(orgId: string): Promise<ModelPriceRow[]> {
    const rows = await this.prisma.modelPrice.findMany({
      where: { orgId },
      orderBy: { model: 'asc' },
    });
    return rows.map(toRow);
  }

  /**
   * Upsert on `(orgId, model)`. The unique constraint guarantees at most one
   * row per model per org — re-PUTting the same `model` atomically replaces the
   * rates.
   */
  async upsert(orgId: string, dto: UpsertModelPriceDto): Promise<ModelPriceRow> {
    const row = await this.prisma.modelPrice.upsert({
      where: { orgId_model: { orgId, model: dto.model } },
      create: {
        orgId,
        model: dto.model,
        inputPerM: dto.inputPerM,
        outputPerM: dto.outputPerM,
      },
      update: {
        inputPerM: dto.inputPerM,
        outputPerM: dto.outputPerM,
      },
    });
    return toRow(row);
  }

  /**
   * Clear a model's override → revert to the shipped default. Scoped by orgId
   * via deleteMany so a cross-org model resolves as 404 with no row leak —
   * same contract as ProviderConfigsService.delete.
   */
  async delete(orgId: string, model: string): Promise<void> {
    const result = await this.prisma.modelPrice.deleteMany({
      where: { orgId, model },
    });
    if (result.count === 0) {
      throw new NotFoundException(`ModelPrice override for "${model}" not found`);
    }
  }
}

function toRow(row: {
  model: string;
  inputPerM: { toString(): string };
  outputPerM: { toString(): string };
  updatedAt: Date;
}): ModelPriceRow {
  const price = toModelPrice(row);
  return {
    model: row.model,
    inputPerM: price.inputPerM,
    outputPerM: price.outputPerM,
    updatedAt: row.updatedAt,
  };
}
