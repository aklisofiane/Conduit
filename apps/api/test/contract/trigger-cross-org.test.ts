import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@conduit/database';
import { TriggerService } from '../../src/modules/trigger/trigger.service';
import { ConnectionsService } from '../../src/modules/connections/connections.service';
import { CredentialsService } from '../../src/modules/credentials/credentials.service';
import { PrismaService } from '../../src/common/prisma.service';
import { seedTwoOrgs, type TwoOrgFixture } from '../../../../test/fixtures/orgs/two-orgs';
import { clearTenantData, makePrisma } from './setup';

/**
 * Cross-org rejection contract for `TriggerService`. Both `listProjects`
 * and `listLabels` 404 before resolving credentials when the connection
 * belongs to a sibling org — we never decrypt cross-org tokens, even on
 * the trigger config-time helpers.
 */
describe('TriggerService cross-org isolation', () => {
  let prisma: PrismaClient;
  let svc: TriggerService;
  let fixture: TwoOrgFixture;

  beforeEach(async () => {
    prisma = makePrisma();
    await clearTenantData(prisma);
    fixture = await seedTwoOrgs(prisma);
    const connections = new ConnectionsService(prisma as unknown as PrismaService);
    const creds = new CredentialsService(prisma as unknown as PrismaService);
    svc = new TriggerService(connections, creds);
  });

  afterEach(async () => {
    await clearTenantData(prisma);
    await prisma.$disconnect();
  });

  it('listProjects on a sibling-org connectionId throws NotFound before hitting GitHub', async () => {
    await expect(
      svc.listProjects(fixture.orgA.id, {
        connectionId: fixture.orgB.connectionId,
        ownerType: 'org',
        owner: 'orgb',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('listLabels on a sibling-org connectionId throws NotFound before hitting GitHub', async () => {
    await expect(
      svc.listLabels(fixture.orgA.id, { connectionId: fixture.orgB.connectionId }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
