import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@conduit/database';
import { ConnectionsService } from '../../src/modules/connections/connections.service';
import { PrismaService } from '../../src/common/prisma.service';
import { seedTwoOrgs, type TwoOrgFixture } from '../../../../test/fixtures/orgs/two-orgs';
import { clearTenantData, makePrisma } from './setup';

/**
 * Lifecycle contract for `ConnectionsService` — the referential-integrity
 * guard on delete (refuse while a workflow trigger / MCP slot still points at
 * the connection) and the list `platform` / `scopeKind` filters. Complements
 * `connections-cross-org.test.ts`, which only covers org scoping.
 *
 * A minimal `WorkflowDefinition`-shaped JSON. `findReferencingWorkflows`
 * scans `definition.triggers[].connectionId|boardConnectionId` and
 * `definition.mcpServers[].connectionId`, so the slots only need those keys.
 */
function definitionWith(opts: {
  triggers?: Array<Record<string, unknown>>;
  mcpServers?: Array<Record<string, unknown>>;
}) {
  return {
    triggers: opts.triggers ?? [],
    nodes: [],
    edges: [],
    mcpServers: opts.mcpServers ?? [],
    ui: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
  };
}

describe('ConnectionsService lifecycle', () => {
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

  describe('create credential check', () => {
    it('rejects a sibling-org credentialId with NotFound and creates no row', async () => {
      const before = await prisma.connection.count({ where: { orgId: fixture.orgA.id } });

      await expect(
        svc.create(fixture.orgA.id, {
          credentialId: fixture.orgB.credentialId,
          name: 'hijack',
          scope: { kind: 'github_repo', owner: 'hacked', repo: 'app' },
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      const after = await prisma.connection.count({ where: { orgId: fixture.orgA.id } });
      expect(after).toBe(before);
    });
  });

  describe('delete referential guard', () => {
    it('refuses to delete a connection referenced by a trigger connectionId', async () => {
      await prisma.workflow.update({
        where: { id: fixture.orgA.workflowId },
        data: {
          name: 'Trigger consumer',
          definition: definitionWith({
            triggers: [{ kind: 'github_issue', connectionId: fixture.orgA.connectionId }],
          }),
        },
      });

      await expect(svc.delete(fixture.orgA.id, fixture.orgA.connectionId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(svc.delete(fixture.orgA.id, fixture.orgA.connectionId)).rejects.toThrow(
        /Trigger consumer/,
      );

      const stillThere = await prisma.connection.findUnique({
        where: { id: fixture.orgA.connectionId },
      });
      expect(stillThere).not.toBeNull();
    });

    it('refuses to delete a connection referenced only via an mcpServers slot', async () => {
      await prisma.workflow.update({
        where: { id: fixture.orgA.workflowId },
        data: {
          name: 'MCP consumer',
          definition: definitionWith({
            mcpServers: [{ id: 'srv1', connectionId: fixture.orgA.connectionId }],
          }),
        },
      });

      await expect(svc.delete(fixture.orgA.id, fixture.orgA.connectionId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(svc.delete(fixture.orgA.id, fixture.orgA.connectionId)).rejects.toThrow(
        /MCP consumer/,
      );

      const stillThere = await prisma.connection.findUnique({
        where: { id: fixture.orgA.connectionId },
      });
      expect(stillThere).not.toBeNull();
    });

    it('deletes an unreferenced connection and removes the row', async () => {
      // The seeded org-A workflow has an empty definition, so the connection
      // is unreferenced.
      await expect(svc.delete(fixture.orgA.id, fixture.orgA.connectionId)).resolves.toBeUndefined();

      const gone = await prisma.connection.findUnique({
        where: { id: fixture.orgA.connectionId },
      });
      expect(gone).toBeNull();
    });
  });

  describe('list filters', () => {
    it('platform filter returns only connections whose credential.platform matches', async () => {
      const gitlabCred = await prisma.credential.create({
        data: {
          orgId: fixture.orgA.id,
          platform: 'GITLAB',
          name: 'A gitlab creds',
          secret: 'placeholder-ciphertext',
        },
      });
      const gitlabConn = await prisma.connection.create({
        data: {
          orgId: fixture.orgA.id,
          credentialId: gitlabCred.id,
          name: 'A gitlab project',
          scope: { kind: 'gitlab_project', projectPath: 'orga/api' },
        },
      });

      const gitlab = await svc.list(fixture.orgA.id, { platform: 'GITLAB' });
      expect(gitlab.map((r) => r.id)).toEqual([gitlabConn.id]);
      expect(gitlab.every((r) => r.credential.platform === 'GITLAB')).toBe(true);

      const github = await svc.list(fixture.orgA.id, { platform: 'GITHUB' });
      expect(github.map((r) => r.id)).toEqual([fixture.orgA.connectionId]);
    });

    it('scopeKind filter returns only connections whose parsed scope.kind matches', async () => {
      const gitlabCred = await prisma.credential.create({
        data: {
          orgId: fixture.orgA.id,
          platform: 'GITLAB',
          name: 'A gitlab creds',
          secret: 'placeholder-ciphertext',
        },
      });
      const gitlabConn = await prisma.connection.create({
        data: {
          orgId: fixture.orgA.id,
          credentialId: gitlabCred.id,
          name: 'A gitlab project',
          scope: { kind: 'gitlab_project', projectPath: 'orga/api' },
        },
      });

      const projects = await svc.list(fixture.orgA.id, { scopeKind: 'gitlab_project' });
      expect(projects.map((r) => r.id)).toEqual([gitlabConn.id]);

      // The seeded connection is `github_repo`, so it is the only match here.
      const repos = await svc.list(fixture.orgA.id, { scopeKind: 'github_repo' });
      expect(repos.map((r) => r.id)).toEqual([fixture.orgA.connectionId]);
    });
  });
});
