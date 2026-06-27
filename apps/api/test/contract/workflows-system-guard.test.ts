import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@conduit/database';
import { WorkflowsService } from '../../src/modules/workflows/workflows.service';
import { PrismaService } from '../../src/common/prisma.service';
import { TemporalService } from '../../src/temporal/temporal.service';
import { clearTenantData, makePrisma } from './setup';

const SYSTEM_WORKFLOW_NAME = 'system-internal';

const definition = {
  triggers: [],
  nodes: [],
  edges: [],
  mcpServers: [],
  ui: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
};

/**
 * SYSTEM workflow guard contract for `WorkflowsService`. SYSTEM workflows
 * are internal-only rows (per-org analysis hosts) that must be invisible and
 * immutable from every user-facing service path — the same org owns them, so
 * only an explicit `kind: 'STANDARD'` guard blocks access.
 */
describe('WorkflowsService SYSTEM workflow guard', () => {
  let prisma: PrismaClient;
  let svc: WorkflowsService;
  let orgId: string;
  let standardWorkflowId: string;
  let systemWorkflowId: string;

  beforeEach(async () => {
    prisma = makePrisma();
    await clearTenantData(prisma);

    const org = await prisma.organization.create({
      data: {
        id: `org_sys_${unique()}`,
        name: 'Test Org',
        slug: `test-org-${unique()}`,
        createdAt: new Date(),
      },
    });
    orgId = org.id;

    const standard = await prisma.workflow.create({
      data: { orgId, name: 'standard workflow', definition, isActive: false },
    });
    standardWorkflowId = standard.id;

    const system = await prisma.workflow.create({
      data: { orgId, name: SYSTEM_WORKFLOW_NAME, definition, isActive: false, kind: 'SYSTEM' },
    });
    systemWorkflowId = system.id;

    svc = new WorkflowsService(
      prisma as unknown as PrismaService,
      fakeTemporal() as unknown as TemporalService,
    );
  });

  afterEach(async () => {
    await clearTenantData(prisma);
    await prisma.$disconnect();
  });

  it('list does not include SYSTEM workflows', async () => {
    const rows = await svc.list(orgId);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(standardWorkflowId);
    expect(ids).not.toContain(systemWorkflowId);
  });

  it('get rejects SYSTEM workflow with NotFound', async () => {
    await expect(svc.get(orgId, systemWorkflowId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update rejects SYSTEM workflow with NotFound and leaves the row unchanged', async () => {
    await expect(svc.update(orgId, systemWorkflowId, { name: 'hijack' })).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const row = await prisma.workflow.findUnique({ where: { id: systemWorkflowId } });
    expect(row?.name).toBe(SYSTEM_WORKFLOW_NAME);
  });

  it('delete rejects SYSTEM workflow with NotFound and leaves the row', async () => {
    await expect(svc.delete(orgId, systemWorkflowId)).rejects.toBeInstanceOf(NotFoundException);

    const row = await prisma.workflow.findUnique({ where: { id: systemWorkflowId } });
    expect(row).not.toBeNull();
  });

  it('duplicate rejects SYSTEM workflow with NotFound', async () => {
    await expect(svc.duplicate(orgId, systemWorkflowId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('setWebhookSecret rejects SYSTEM workflow with NotFound and leaves webhookSecret null', async () => {
    await expect(svc.setWebhookSecret(orgId, systemWorkflowId, 'secret')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const row = await prisma.workflow.findUnique({ where: { id: systemWorkflowId } });
    expect(row?.webhookSecret).toBeNull();
  });

  it('clearWebhookSecret rejects SYSTEM workflow with NotFound', async () => {
    await expect(svc.clearWebhookSecret(orgId, systemWorkflowId)).rejects.toBeInstanceOf(
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

let counter = 0;
function unique(): string {
  counter += 1;
  return `${Date.now().toString(36)}_${process.pid}_${counter}`;
}
