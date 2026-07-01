import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@conduit/database';
import { ModelPricingService } from '../../src/modules/model-pricing/model-pricing.service';
import { PrismaService } from '../../src/common/prisma.service';
import { seedTwoOrgs, type TwoOrgFixture } from '../../../../test/fixtures/orgs/two-orgs';
import { clearTenantData, makePrisma } from './setup';

/**
 * Upsert + delete + list contract for `ModelPricingService`. Mirrors
 * `provider-configs-cross-org` but keys overrides on `(orgId, model)` and
 * exposes Decimal rates as plain numbers:
 *   - list returns only own-org rows,
 *   - PUT upserts on `(orgId, model)` — re-PUTting replaces the rates in place,
 *   - DELETE clears an override (revert to default); cross-org model -> 404,
 *   - Decimal columns round-trip as numbers.
 */
describe('ModelPricingService upsert + delete + list', () => {
  let prisma: PrismaClient;
  let svc: ModelPricingService;
  let fixture: TwoOrgFixture;

  beforeEach(async () => {
    prisma = makePrisma();
    await clearTenantData(prisma);
    await prisma.modelPrice.deleteMany({});
    fixture = await seedTwoOrgs(prisma);
    svc = new ModelPricingService(prisma as unknown as PrismaService);

    await prisma.modelPrice.create({
      data: {
        orgId: fixture.orgA.id,
        model: 'claude-opus-4-8',
        inputPerM: 12.5,
        outputPerM: 60,
      },
    });
    await prisma.modelPrice.create({
      data: {
        orgId: fixture.orgB.id,
        model: 'claude-opus-4-8',
        inputPerM: 9,
        outputPerM: 40,
      },
    });
  });

  afterEach(async () => {
    await prisma.modelPrice.deleteMany({});
    await clearTenantData(prisma);
    await prisma.$disconnect();
  });

  it('list returns only the caller-org overrides with numeric rates', async () => {
    const a = await svc.list(fixture.orgA.id);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      model: 'claude-opus-4-8',
      inputPerM: 12.5,
      outputPerM: 60,
    });
    expect(typeof a[0].inputPerM).toBe('number');

    const b = await svc.list(fixture.orgB.id);
    expect(b).toHaveLength(1);
    expect(b[0].inputPerM).toBe(9);
  });

  it('upsert on an existing model replaces the rates in place (one row)', async () => {
    const updated = await svc.upsert(fixture.orgA.id, {
      model: 'claude-opus-4-8',
      inputPerM: 20,
      outputPerM: 90,
    });
    expect(updated).toMatchObject({ model: 'claude-opus-4-8', inputPerM: 20, outputPerM: 90 });

    const rows = await prisma.modelPrice.findMany({
      where: { orgId: fixture.orgA.id, model: 'claude-opus-4-8' },
    });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].inputPerM)).toBe(20);
    expect(Number(rows[0].outputPerM)).toBe(90);
  });

  it('upsert for a new model stamps caller-org orgId and adds a row', async () => {
    const created = await svc.upsert(fixture.orgA.id, {
      model: 'claude-sonnet-5',
      inputPerM: 3,
      outputPerM: 15,
    });
    expect(created.model).toBe('claude-sonnet-5');

    const rows = await prisma.modelPrice.findMany({ where: { orgId: fixture.orgA.id } });
    expect(rows.map((r) => r.model).sort()).toEqual(['claude-opus-4-8', 'claude-sonnet-5']);
    const sonnet = rows.find((r) => r.model === 'claude-sonnet-5');
    expect(sonnet?.orgId).toBe(fixture.orgA.id);
  });

  it('delete clears an own-org override (revert to default)', async () => {
    await svc.delete(fixture.orgA.id, 'claude-opus-4-8');
    const rows = await prisma.modelPrice.findMany({ where: { orgId: fixture.orgA.id } });
    expect(rows).toHaveLength(0);
  });

  it('delete on a model the caller-org has not overridden throws NotFound', async () => {
    await expect(svc.delete(fixture.orgA.id, 'gpt-5.5')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('delete does not touch a sibling-org override of the same model', async () => {
    await expect(svc.delete(fixture.orgA.id, 'claude-opus-4-8')).resolves.toBeUndefined();
    // orgB's row for the same model survives — delete is orgId-scoped.
    const b = await prisma.modelPrice.findMany({ where: { orgId: fixture.orgB.id } });
    expect(b).toHaveLength(1);
    expect(b[0].model).toBe('claude-opus-4-8');
  });
});
