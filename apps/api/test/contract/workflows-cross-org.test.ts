import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@conduit/database';
import { WorkflowsService } from '../../src/modules/workflows/workflows.service';
import { PrismaService } from '../../src/common/prisma.service';
import { TemporalService } from '../../src/temporal/temporal.service';
import { seedTwoOrgs, type TwoOrgFixture } from '../../../../test/fixtures/orgs/two-orgs';
import { clearTenantData, makePrisma } from './setup';

/**
 * Cross-org rejection contract for `WorkflowsService`. Every read/write
 * method takes an explicit `orgId`; passing org A's id while referencing
 * org B's row must surface as 404 (not 403) — we don't confirm the
 * existence of cross-org rows.
 */
describe('WorkflowsService cross-org isolation', () => {
  let prisma: PrismaClient;
  let svc: WorkflowsService;
  let fixture: TwoOrgFixture;

  beforeEach(async () => {
    prisma = makePrisma();
    await clearTenantData(prisma);
    fixture = await seedTwoOrgs(prisma);
    svc = new WorkflowsService(
      prisma as unknown as PrismaService,
      fakeTemporal() as unknown as TemporalService,
    );
  });

  afterEach(async () => {
    await clearTenantData(prisma);
    await prisma.$disconnect();
  });

  it('list returns only the caller-org workflows', async () => {
    const aRows = await svc.list(fixture.orgA.id);
    expect(aRows.map((r) => r.id)).toEqual([fixture.orgA.workflowId]);

    const bRows = await svc.list(fixture.orgB.id);
    expect(bRows.map((r) => r.id)).toEqual([fixture.orgB.workflowId]);
  });

  it('get on a sibling-org workflow id throws NotFound', async () => {
    await expect(svc.get(fixture.orgA.id, fixture.orgB.workflowId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('update on a sibling-org workflow id throws NotFound and writes nothing', async () => {
    await expect(
      svc.update(fixture.orgA.id, fixture.orgB.workflowId, { name: 'hijack' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const orgBRow = await prisma.workflow.findUnique({ where: { id: fixture.orgB.workflowId } });
    expect(orgBRow?.name).toBe('B workflow');
  });

  it('delete on a sibling-org workflow id throws NotFound and leaves the row', async () => {
    await expect(svc.delete(fixture.orgA.id, fixture.orgB.workflowId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const orgBRow = await prisma.workflow.findUnique({ where: { id: fixture.orgB.workflowId } });
    expect(orgBRow).not.toBeNull();
  });

  it('duplicate on a sibling-org workflow id throws NotFound', async () => {
    await expect(svc.duplicate(fixture.orgA.id, fixture.orgB.workflowId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('create stamps caller-org orgId on the new row', async () => {
    const created = await svc.create(fixture.orgA.id, { name: 'fresh' });
    expect(created.orgId).toBe(fixture.orgA.id);
  });
});

describe('SYSTEM workflow mutation isolation', () => {
  let prisma: PrismaClient;
  let svc: WorkflowsService;
  let fixture: TwoOrgFixture;
  let systemWorkflowId: string;

  beforeEach(async () => {
    prisma = makePrisma();
    await clearTenantData(prisma);
    fixture = await seedTwoOrgs(prisma);
    svc = new WorkflowsService(
      prisma as unknown as PrismaService,
      fakeTemporal() as unknown as TemporalService,
    );
    const systemWorkflow = await prisma.workflow.create({
      data: {
        orgId: fixture.orgA.id,
        kind: 'SYSTEM',
        name: 'Conduit System (analysis)',
        isActive: false,
        definition: {
          triggers: [],
          nodes: [],
          edges: [],
          mcpServers: [],
          ui: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
        },
      },
    });
    systemWorkflowId = systemWorkflow.id;
  });

  afterEach(async () => {
    await clearTenantData(prisma);
    await prisma.$disconnect();
  });

  it('list excludes SYSTEM workflows from same-org results', async () => {
    const rows = await svc.list(fixture.orgA.id);
    expect(rows.map((r) => r.id)).not.toContain(systemWorkflowId);
  });

  it('get on a same-org SYSTEM workflow throws NotFound', async () => {
    await expect(svc.get(fixture.orgA.id, systemWorkflowId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('update on a same-org SYSTEM workflow throws NotFound and writes nothing', async () => {
    await expect(
      svc.update(fixture.orgA.id, systemWorkflowId, { name: 'hijack' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const row = await prisma.workflow.findUnique({ where: { id: systemWorkflowId } });
    expect(row?.name).toBe('Conduit System (analysis)');
  });

  it('delete on a same-org SYSTEM workflow throws NotFound and leaves the row', async () => {
    await expect(svc.delete(fixture.orgA.id, systemWorkflowId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const row = await prisma.workflow.findUnique({ where: { id: systemWorkflowId } });
    expect(row).not.toBeNull();
  });

  it('duplicate on a same-org SYSTEM workflow throws NotFound', async () => {
    await expect(svc.duplicate(fixture.orgA.id, systemWorkflowId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('setWebhookSecret on a same-org SYSTEM workflow throws NotFound', async () => {
    await expect(
      svc.setWebhookSecret(fixture.orgA.id, systemWorkflowId, 'secret'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('clearWebhookSecret on a same-org SYSTEM workflow throws NotFound', async () => {
    await expect(svc.clearWebhookSecret(fixture.orgA.id, systemWorkflowId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

function fakeTemporal() {
  return {
    upsertWorkflowSchedule: async () => undefined,
    deleteWorkflowSchedule: async () => undefined,
    cancelAgentWorkflow: async () => undefined,
    startAgentWorkflow: async () => ({
      temporalWorkflowId: 'fake-tw',
      temporalRunId: 'fake-run',
    }),
  };
}
