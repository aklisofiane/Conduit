import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@conduit/database';
import { RunsService } from '../../src/modules/runs/runs.service';
import { PrismaService } from '../../src/common/prisma.service';
import { TemporalService } from '../../src/temporal/temporal.service';
import { WorkflowsService } from '../../src/modules/workflows/workflows.service';
import { seedTwoOrgs, type TwoOrgFixture } from '../../../../test/fixtures/orgs/two-orgs';
import { clearTenantData, makePrisma } from './setup';

/**
 * Cross-org rejection contract for `RunsService`. Run + log lookups are
 * filtered by `orgId` even when the caller knows the run id, so cross-org
 * probes resolve as 404.
 */
describe('RunsService cross-org isolation', () => {
  let prisma: PrismaClient;
  let svc: RunsService;
  let fixture: TwoOrgFixture;
  let startRunCalls: Array<{ orgId: string; workflowId: string; trigger: unknown }>;

  beforeEach(async () => {
    prisma = makePrisma();
    await clearTenantData(prisma);
    fixture = await seedTwoOrgs(prisma);
    startRunCalls = [];
    svc = new RunsService(
      prisma as unknown as PrismaService,
      fakeTemporal() as unknown as TemporalService,
      fakeWorkflows(startRunCalls) as unknown as WorkflowsService,
    );
  });

  afterEach(async () => {
    await clearTenantData(prisma);
    await prisma.$disconnect();
  });

  it('listForWorkflow returns nothing when given a sibling-org workflow id', async () => {
    const rows = await svc.listForWorkflow(fixture.orgA.id, fixture.orgB.workflowId);
    expect(rows).toEqual([]);
  });

  it('listForWorkflow returns own-org runs', async () => {
    const rows = await svc.listForWorkflow(fixture.orgA.id, fixture.orgA.workflowId);
    expect(rows.map((r) => r.id)).toEqual([fixture.orgA.runId]);
  });

  it('get on a sibling-org run id throws NotFound', async () => {
    await expect(svc.get(fixture.orgA.id, fixture.orgB.runId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('cancel on a sibling-org run id throws NotFound', async () => {
    await expect(svc.cancel(fixture.orgA.id, fixture.orgB.runId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('logs returns nothing when given a sibling-org run id', async () => {
    const rows = await svc.logs(fixture.orgA.id, fixture.orgB.runId, {});
    expect(rows).toEqual([]);
  });

  it('rerun on a sibling-org run id throws NotFound', async () => {
    await expect(svc.rerun(fixture.orgA.id, fixture.orgB.runId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(startRunCalls).toEqual([]);
  });

  it('rerun rejects a non-FAILED run (the seeded runs are COMPLETED)', async () => {
    await expect(svc.rerun(fixture.orgA.id, fixture.orgA.runId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(startRunCalls).toEqual([]);
  });

  it('rerun replays the persisted trigger of a FAILED run through startRun', async () => {
    const trigger = { source: 'github', mode: 'webhook', event: 'issues' };
    const failed = await prisma.workflowRun.create({
      data: {
        orgId: fixture.orgA.id,
        workflowId: fixture.orgA.workflowId,
        status: 'FAILED',
        trigger,
        error: 'boom',
        finishedAt: new Date(),
      },
    });

    const result = await svc.rerun(fixture.orgA.id, failed.id);

    expect(startRunCalls).toEqual([
      { orgId: fixture.orgA.id, workflowId: fixture.orgA.workflowId, trigger },
    ]);
    expect(result).toMatchObject({ id: 'new-run' });
  });
});

function fakeTemporal() {
  return {
    cancelAgentWorkflow: async () => undefined,
  };
}

function fakeWorkflows(calls: Array<{ orgId: string; workflowId: string; trigger: unknown }>) {
  return {
    startRun: async (orgId: string, workflowId: string, trigger: unknown) => {
      calls.push({ orgId, workflowId, trigger });
      return { id: 'new-run', workflowId };
    },
  };
}
