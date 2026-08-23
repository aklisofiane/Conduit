import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@conduit/database';
import { CredentialsService } from '../../src/modules/credentials/credentials.service';
import { PrismaService } from '../../src/common/prisma.service';
import { seedTwoOrgs, type TwoOrgFixture } from '../../../../test/fixtures/orgs/two-orgs';
import { clearTenantData, makePrisma } from './setup';

/**
 * Cross-org rejection contract for `CredentialsService`. The decryption
 * helpers (`decryptForConnection`, `getConnectionBinding`) stay unscoped on
 * purpose — they're worker-side server-trusted code — so they're not part
 * of this matrix.
 */
describe('CredentialsService cross-org isolation', () => {
  let prisma: PrismaClient;
  let svc: CredentialsService;
  let fixture: TwoOrgFixture;

  beforeEach(async () => {
    prisma = makePrisma();
    await clearTenantData(prisma);
    fixture = await seedTwoOrgs(prisma);
    svc = new CredentialsService(prisma as unknown as PrismaService);
  });

  afterEach(async () => {
    await clearTenantData(prisma);
    await prisma.$disconnect();
  });

  it('list returns only the caller-org credentials', async () => {
    const a = await svc.list(fixture.orgA.id);
    expect(a.map((r) => r.id)).toEqual([fixture.orgA.credentialId]);

    const b = await svc.list(fixture.orgB.id);
    expect(b.map((r) => r.id)).toEqual([fixture.orgB.credentialId]);
  });

  it('update on a sibling-org credential throws NotFound', async () => {
    await expect(
      svc.update(fixture.orgA.id, fixture.orgB.credentialId, { name: 'rename' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('delete on a sibling-org credential throws NotFound and leaves the row', async () => {
    await expect(svc.delete(fixture.orgA.id, fixture.orgB.credentialId)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const stillThere = await prisma.credential.findUnique({
      where: { id: fixture.orgB.credentialId },
    });
    expect(stillThere).not.toBeNull();
  });

  it('create stamps caller-org orgId on the new row', async () => {
    const created = await svc.create(fixture.orgA.id, {
      platform: 'GITHUB',
      name: 'another',
      secret: 'plaintext-token',
    });
    const row = await prisma.credential.findUnique({ where: { id: created.id } });
    expect(row?.orgId).toBe(fixture.orgA.id);
  });
});
