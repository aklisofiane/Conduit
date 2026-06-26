import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { PrismaClient } from '@conduit/database';
import { workflowToTemplate, type WorkflowDefinition } from '@conduit/shared';
import { TemplatesService } from '../../src/modules/templates/templates.service';
import type { PrismaService } from '../../src/common/prisma.service';
import type { TemporalService } from '../../src/temporal/temporal.service';
import type { AgentPresetsService } from '../../src/modules/agent-presets/agent-presets.service';
import { seedTwoOrgs, type TwoOrgFixture } from '../../../../test/fixtures/orgs/two-orgs';
import { clearTenantData, makePrisma } from './setup';

/**
 * Scope-kind compatibility guard on the import path. A trigger's
 * `connectionId` slot carries `expectedScopeKind: 'repo'`, so the derived
 * placeholder requires a repo-family scope. `assertScopeCompatible` is the
 * thing that stops a board-scoped (github_projects_v2) connection from being
 * wired into a repo trigger — a mismatch that would otherwise only blow up at
 * run time. The 'repo' family deliberately accepts both `github_repo` and
 * `gitlab_project`. These tests exercise that guard through both binding
 * modes: `existing` (validated against the persisted Connection row before the
 * transaction) and `new` (validated inside the transaction, before any
 * Connection row is created).
 */
describe('TemplatesService.importTemplate scope compatibility', () => {
  let prisma: PrismaClient;
  let svc: TemplatesService;
  let fixture: TwoOrgFixture;

  beforeEach(async () => {
    prisma = makePrisma();
    await clearTenantData(prisma);
    fixture = await seedTwoOrgs(prisma);
    const temporalStub = {
      upsertWorkflowSchedule: async () => undefined,
    } as unknown as TemporalService;
    svc = new TemplatesService(
      prisma as unknown as PrismaService,
      temporalStub,
      {} as AgentPresetsService,
    );
  });

  afterEach(async () => {
    await clearTenantData(prisma);
    await prisma.$disconnect();
  });

  it('rejects an existing-binding whose scope is github_projects_v2 for a repo-expecting slot', async () => {
    // A board-scoped connection in the importer's own org — visible, but the
    // wrong shape for a trigger's repo slot.
    const boardConnId = await createConnection(prisma, fixture.orgA, {
      kind: 'github_projects_v2',
      ownerType: 'org',
      owner: 'orga',
      number: 7,
    });
    const file = workflowToTemplate(
      { name: 'Board Into Repo', definition: liveDefinition('conn_repo') },
      { aliasFor: () => 'repo' },
    );

    await expect(
      svc.importTemplate(fixture.orgA.id, {
        template: file,
        bindings: { repo: { mode: 'existing', connectionId: boardConnId } },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a github_repo connection for a repo-expecting slot (repo family)', async () => {
    const repoConnId = await createConnection(prisma, fixture.orgA, {
      kind: 'github_repo',
      owner: 'orga',
      repo: 'app',
    });
    const file = workflowToTemplate(
      { name: 'GitHub Repo Bind', definition: liveDefinition('conn_repo') },
      { aliasFor: () => 'repo' },
    );

    const created = await svc.importTemplate(fixture.orgA.id, {
      template: file,
      bindings: { repo: { mode: 'existing', connectionId: repoConnId } },
    });

    expect(created.workflows).toHaveLength(1);
    const definition = await loadDefinition(prisma, created.workflows[0]!.id);
    expect(definition.triggers[0].connectionId).toBe(repoConnId);
    expect(definition.triggers[0].platform).toBe('github');
  });

  it('accepts a gitlab_project connection for the same repo-expecting slot (repo family)', async () => {
    const gitlabConnId = await createConnection(prisma, fixture.orgA, {
      kind: 'gitlab_project',
      projectPath: 'orga/app',
    });
    const file = workflowToTemplate(
      { name: 'GitLab Project Bind', definition: liveDefinition('conn_repo') },
      { aliasFor: () => 'repo' },
    );

    const created = await svc.importTemplate(fixture.orgA.id, {
      template: file,
      bindings: { repo: { mode: 'existing', connectionId: gitlabConnId } },
    });

    expect(created.workflows).toHaveLength(1);
    const definition = await loadDefinition(prisma, created.workflows[0]!.id);
    expect(definition.triggers[0].connectionId).toBe(gitlabConnId);
    // A gitlab_project binding re-derives the trigger platform from the scope.
    expect(definition.triggers[0].platform).toBe('gitlab');
  });

  it('rejects a new-binding with an incompatible scope before any Connection row is created', async () => {
    const before = await prisma.connection.count({
      where: { orgId: fixture.orgA.id },
    });
    const file = workflowToTemplate(
      { name: 'New Board Into Repo', definition: liveDefinition('conn_repo') },
      { aliasFor: () => 'repo' },
    );

    await expect(
      svc.importTemplate(fixture.orgA.id, {
        template: file,
        bindings: {
          repo: {
            mode: 'new',
            name: 'A board',
            credentialId: fixture.orgA.credentialId,
            scope: {
              kind: 'github_projects_v2',
              ownerType: 'org',
              owner: 'orga',
              number: 3,
            },
          },
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // The guard fires before the `tx.connection.create`, and the transaction
    // rolls back regardless — no new Connection row is persisted.
    const after = await prisma.connection.count({
      where: { orgId: fixture.orgA.id },
    });
    expect(after).toBe(before);
  });
});

function liveDefinition(connectionId: string): WorkflowDefinition {
  return {
    triggers: [
      {
        id: 'trigger-1',
        name: 'Trigger1',
        platform: 'github',
        connectionId,
        type: 'webhook',
        event: 'issues.opened',
        filters: [],
      },
    ],
    nodes: [
      {
        id: 'agent-a',
        name: 'A',
        provider: 'claude',
        model: 'stub',
        instructions: 'do something',
        mcpServers: [],
        skills: [],
        webSearch: false,
      },
    ],
    edges: [{ from: 'Trigger1', to: 'A' }],
    mcpServers: [],
    ui: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
  };
}

async function createConnection(
  prisma: PrismaClient,
  org: { id: string; credentialId: string },
  scope: Record<string, unknown>,
): Promise<string> {
  const conn = await prisma.connection.create({
    data: {
      orgId: org.id,
      credentialId: org.credentialId,
      name: `conn-${scope.kind as string}`,
      scope: scope as unknown as object,
    },
    select: { id: true },
  });
  return conn.id;
}

async function loadDefinition(prisma: PrismaClient, workflowId: string) {
  const wf = await prisma.workflow.findUniqueOrThrow({
    where: { id: workflowId },
    select: { definition: true },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return wf.definition as any;
}
