import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@conduit/database';
import { ConnectionsService } from '../../src/modules/connections/connections.service';
import { PrismaService } from '../../src/common/prisma.service';
import { seedTwoOrgs, type TwoOrgFixture } from '../../../../test/fixtures/orgs/two-orgs';
import { clearTenantData, makePrisma } from './setup';

/**
 * Cross-org rejection contract for `ConnectionsService`. Includes the
 * spec's "Connection.create with another org's credentialId → 404"
 * invariant — we never confirm the existence of cross-org credential rows.
 */
describe('ConnectionsService cross-org isolation', () => {
  let prisma: PrismaClient;
  let svc: ConnectionsService;
  let fixture: TwoOrgFixture;

  beforeEach(async () => {
    prisma = makePrisma();
    await clearTenantData(prisma);
    fixture = await seedTwoOrgs(prisma);
    svc = new ConnectionsService(prisma as unknown as PrismaService);
  });

  afterEach(async () => {
    await clearTenantData(prisma);
    await prisma.$disconnect();
  });

  it('list returns only the caller-org connections', async () => {
    const a = await svc.list(fixture.orgA.id);
    expect(a.map((r) => r.id)).toEqual([fixture.orgA.connectionId]);

    const b = await svc.list(fixture.orgB.id);
    expect(b.map((r) => r.id)).toEqual([fixture.orgB.connectionId]);
  });

  it('get on a sibling-org connection id throws NotFound', async () => {
    await expect(svc.get(fixture.orgA.id, fixture.orgB.connectionId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('create with a cross-org credentialId resolves as 404, not 403', async () => {
    await expect(
      svc.create(fixture.orgA.id, {
        credentialId: fixture.orgB.credentialId,
        name: 'hijack',
        scope: { kind: 'github_repo', owner: 'hacked', repo: 'app' },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update on a sibling-org connection throws NotFound', async () => {
    await expect(
      svc.update(fixture.orgA.id, fixture.orgB.connectionId, { name: 'rename' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('delete on a sibling-org connection throws NotFound', async () => {
    await expect(svc.delete(fixture.orgA.id, fixture.orgB.connectionId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const stillThere = await prisma.connection.findUnique({
      where: { id: fixture.orgB.connectionId },
    });
    expect(stillThere).not.toBeNull();
  });

  it('create stamps caller-org orgId on the new row', async () => {
    const created = await svc.create(fixture.orgA.id, {
      credentialId: fixture.orgA.credentialId,
      name: 'second',
      scope: { kind: 'github_repo', owner: 'orga', repo: 'two' },
    });
    const row = await prisma.connection.findUnique({ where: { id: created.id } });
    expect(row?.orgId).toBe(fixture.orgA.id);
  });
});
