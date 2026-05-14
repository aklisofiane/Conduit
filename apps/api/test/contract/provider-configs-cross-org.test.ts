import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@conduit/database';
import { ProviderConfigsService } from '../../src/modules/provider-configs/provider-configs.service';
import { encrypt } from '../../src/modules/provider-configs/crypto';
import { PrismaService } from '../../src/common/prisma.service';
import { seedTwoOrgs, type TwoOrgFixture } from '../../../../test/fixtures/orgs/two-orgs';
import { clearTenantData, makePrisma } from './setup';

/**
 * Cross-org rejection contract for `ProviderConfigsService`. Mirrors the
 * `CredentialsService` matrix: list returns only own-org rows, mutations on
 * sibling-org ids resolve as 404 with no row leak, and creates stamp the
 * caller's orgId. Also covers the upsert semantics on `(orgId, providerId)`
 * — POSTing twice with the same providerId replaces the row in place.
 */
describe('ProviderConfigsService cross-org isolation', () => {
  let prisma: PrismaClient;
  let svc: ProviderConfigsService;
  let fixture: TwoOrgFixture;
  let orgARowId: string;
  let orgBRowId: string;

  beforeEach(async () => {
    prisma = makePrisma();
    await clearTenantData(prisma);
    await prisma.providerConfig.deleteMany({});
    fixture = await seedTwoOrgs(prisma);
    svc = new ProviderConfigsService(prisma as unknown as PrismaService);

    const a = await prisma.providerConfig.create({
      data: {
        orgId: fixture.orgA.id,
        providerId: 'claude',
        encryptedApiKey: encrypt('sk-ant-org-a-1234'),
        baseUrl: 'https://proxy.a.example/v1',
      },
    });
    const b = await prisma.providerConfig.create({
      data: {
        orgId: fixture.orgB.id,
        providerId: 'claude',
        encryptedApiKey: encrypt('sk-ant-org-b-5678'),
      },
    });
    orgARowId = a.id;
    orgBRowId = b.id;
  });

  afterEach(async () => {
    await prisma.providerConfig.deleteMany({});
    await clearTenantData(prisma);
    await prisma.$disconnect();
  });

  it('list returns only the caller-org rows in the redacted shape', async () => {
    const a = await svc.list(fixture.orgA.id);
    expect(a.map((r) => r.id)).toEqual([orgARowId]);
    expect(a[0]).toMatchObject({
      providerId: 'claude',
      baseUrl: 'https://proxy.a.example/v1',
      suffix: '1234',
    });
    // Never leak ciphertext or plaintext via the redacted shape.
    expect(Object.keys(a[0])).not.toContain('encryptedApiKey');
    expect(Object.keys(a[0])).not.toContain('apiKey');

    const b = await svc.list(fixture.orgB.id);
    expect(b.map((r) => r.id)).toEqual([orgBRowId]);
    expect(b[0].suffix).toBe('5678');
  });

  it('create upserts on (orgId, providerId) — same providerId replaces atomically', async () => {
    const replaced = await svc.create(fixture.orgA.id, {
      providerId: 'claude',
      apiKey: 'sk-ant-rotated-9999',
      baseUrl: 'https://litellm.example/v1',
    });
    expect(replaced.id).toBe(orgARowId);
    expect(replaced.suffix).toBe('9999');
    expect(replaced.baseUrl).toBe('https://litellm.example/v1');

    const rows = await prisma.providerConfig.findMany({
      where: { orgId: fixture.orgA.id },
    });
    expect(rows).toHaveLength(1);
  });

  it('create stamps caller-org orgId for a new providerId', async () => {
    const created = await svc.create(fixture.orgA.id, {
      providerId: 'codex',
      apiKey: 'sk-codex-abcd',
    });
    const row = await prisma.providerConfig.findUnique({ where: { id: created.id } });
    expect(row?.orgId).toBe(fixture.orgA.id);
    expect(row?.providerId).toBe('codex');
    expect(row?.baseUrl).toBeNull();
  });

  it('update on a sibling-org row throws NotFound and leaves it untouched', async () => {
    await expect(
      svc.update(fixture.orgA.id, orgBRowId, { apiKey: 'hijack' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    const row = await prisma.providerConfig.findUnique({ where: { id: orgBRowId } });
    expect(row?.encryptedApiKey).not.toContain('hijack');
  });

  it('update applies a partial patch — apiKey only', async () => {
    const updated = await svc.update(fixture.orgA.id, orgARowId, {
      apiKey: 'sk-ant-rotated-0001',
    });
    expect(updated.suffix).toBe('0001');
    expect(updated.baseUrl).toBe('https://proxy.a.example/v1');
  });

  it('update can clear baseUrl by passing null', async () => {
    const updated = await svc.update(fixture.orgA.id, orgARowId, {
      baseUrl: null,
    });
    expect(updated.baseUrl).toBeNull();
  });

  it('delete on a sibling-org row throws NotFound and leaves the row', async () => {
    await expect(
      svc.delete(fixture.orgA.id, orgBRowId),
    ).rejects.toBeInstanceOf(NotFoundException);
    const stillThere = await prisma.providerConfig.findUnique({
      where: { id: orgBRowId },
    });
    expect(stillThere).not.toBeNull();
  });

  it('delete on an own-org row removes it', async () => {
    await svc.delete(fixture.orgA.id, orgARowId);
    const gone = await prisma.providerConfig.findUnique({ where: { id: orgARowId } });
    expect(gone).toBeNull();
  });
});
