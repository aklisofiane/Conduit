import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@conduit/database';
import { TriggerService } from '../../src/modules/trigger/trigger.service';
import { ConnectionsService } from '../../src/modules/connections/connections.service';
import { CredentialsService } from '../../src/modules/credentials/credentials.service';
import { encrypt } from '../../src/modules/credentials/crypto';
import { PrismaService } from '../../src/common/prisma.service';
import { seedTwoOrgs, type TwoOrgFixture } from '../../../../test/fixtures/orgs/two-orgs';
import { clearTenantData, makePrisma } from './setup';

/**
 * Contract for `TriggerService.listBranches` — the cron branch picker's
 * config-time endpoint. Resolves the connection's token + repo scope, calls
 * the platform, and returns branch names. Cross-org connection ids 404 before
 * decrypting; a connection not bound to a repo/project is a 400.
 *
 * The platform REST call is intercepted via a global `fetch` stub so the test
 * stays offline; the connection credential is written with a real encrypted
 * token so the binding resolves end-to-end.
 */
describe('TriggerService.listBranches', () => {
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
    vi.unstubAllGlobals();
    await clearTenantData(prisma);
    await prisma.$disconnect();
  });

  it('resolves the connection token + repo scope and returns branch names', async () => {
    // Make orgA's connection credential decryptable so the binding resolves.
    await prisma.credential.update({
      where: { id: fixture.orgA.credentialId },
      data: { secret: encrypt('gh-token') },
    });

    let captured: { url: string; auth: string } | undefined;
    const fakeFetch = vi.fn(async (url: string, init: RequestInit) => {
      captured = {
        url,
        auth: (init.headers as Record<string, string>).Authorization,
      };
      return new Response(JSON.stringify([{ name: 'main' }, { name: 'release/2.0' }]), {
        status: 200,
      });
    });
    vi.stubGlobal('fetch', fakeFetch);

    const branches = await svc.listBranches(fixture.orgA.id, {
      connectionId: fixture.orgA.connectionId,
    });

    expect(branches).toEqual(['main', 'release/2.0']);
    // orgA's seeded scope is { github_repo, owner: 'orga', repo: 'app' }.
    expect(captured!.url).toContain('/repos/orga/app/branches');
    expect(captured!.auth).toBe('Bearer gh-token');
  });

  it('404s on a sibling-org connectionId before hitting the platform', async () => {
    const fakeFetch = vi.fn();
    vi.stubGlobal('fetch', fakeFetch);

    await expect(
      svc.listBranches(fixture.orgA.id, { connectionId: fixture.orgB.connectionId }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it('400s when the connection is not bound to a repo/project', async () => {
    const cred = await prisma.credential.create({
      data: {
        orgId: fixture.orgA.id,
        platform: 'GITHUB',
        name: 'A board creds',
        secret: encrypt('gh-token'),
      },
    });
    const boardConn = await prisma.connection.create({
      data: {
        orgId: fixture.orgA.id,
        credentialId: cred.id,
        name: 'A board',
        scope: { kind: 'github_projects_v2', ownerType: 'org', owner: 'orga', number: 1 },
      },
    });

    const fakeFetch = vi.fn();
    vi.stubGlobal('fetch', fakeFetch);

    await expect(
      svc.listBranches(fixture.orgA.id, { connectionId: boardConn.id }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fakeFetch).not.toHaveBeenCalled();
  });
});
