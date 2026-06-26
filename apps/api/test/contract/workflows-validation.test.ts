import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { PrismaClient } from '@conduit/database';
import { workflowDefinitionSchema, type WorkflowScheduleOptions } from '@conduit/shared';
import { WorkflowsService } from '../../src/modules/workflows/workflows.service';
import { defaultDefinition } from '../../src/modules/workflows/defaults';
import type { PrismaService } from '../../src/common/prisma.service';
import type { TemporalService } from '../../src/temporal/temporal.service';
import { seedTwoOrgs, type TwoOrgFixture } from '../../../../test/fixtures/orgs/two-orgs';
import { clearTenantData, makePrisma } from './setup';

/**
 * Validation contract for `WorkflowsService.create` / `update` / `duplicate`.
 *
 * Covers the surfaces the slug-freeze spec leaves untested:
 *   - create injects `defaultDefinition(triggerType)` when no definition is given
 *     and always persists paused (`isActive: false`);
 *   - a structurally/semantically invalid definition is rejected as a 400 with
 *     no row written;
 *   - the activation gate (`assertActivatable`) requires *exactly one* trigger
 *     and fires *before* the DB write, so a half-built workflow can never flip
 *     to active;
 *   - `duplicate` clones the row paused, copying definition + webhookSecret.
 */
describe('WorkflowsService create/update validation + activation gate', () => {
  let prisma: PrismaClient;
  let fixture: TwoOrgFixture;
  let upserts: WorkflowScheduleOptions[];
  let deletes: DeleteCall[];
  let svc: WorkflowsService;

  beforeEach(async () => {
    prisma = makePrisma();
    await clearTenantData(prisma);
    fixture = await seedTwoOrgs(prisma);
    upserts = [];
    deletes = [];
    svc = new WorkflowsService(
      prisma as unknown as PrismaService,
      recordingTemporal(upserts, deletes) as unknown as TemporalService,
    );
  });

  afterEach(async () => {
    await clearTenantData(prisma);
    await prisma.$disconnect();
  });

  it('injects the empty default definition (paused, schema-valid) when none is supplied', async () => {
    const created = await svc.create(fixture.orgA.id, { name: 'No Def WF' });

    const row = await prisma.workflow.findUniqueOrThrow({ where: { id: created.id } });
    // Exactly the blank canvas `defaultDefinition()` returns.
    expect(row.definition).toEqual(defaultDefinition());
    // Persisted definition round-trips through the public schema.
    expect(workflowDefinitionSchema.safeParse(row.definition).success).toBe(true);
    // Create never auto-activates — the user reviews before going live.
    expect(row.isActive).toBe(false);
  });

  it('injects defaultDefinition(triggerType) so the chosen trigger is placed', async () => {
    const created = await svc.create(fixture.orgA.id, {
      name: 'Issues WF',
      triggerType: 'issues',
    });

    const row = await prisma.workflow.findUniqueOrThrow({ where: { id: created.id } });
    const def = row.definition as ReturnType<typeof defaultDefinition>;
    expect(def.triggers).toHaveLength(1);
    expect(def.triggers[0]?.type).toBe('issues');
    expect(def.triggers[0]?.name).toBe('Trigger1');
    expect(row.isActive).toBe(false);
  });

  it('rejects a semantically invalid definition with 400 and writes no row', async () => {
    const before = await prisma.workflow.count();

    await expect(
      svc.create(fixture.orgA.id, {
        name: 'Bad WF',
        definition: badWebhookDefinition(fixture.orgA.connectionId),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // The throw happens before `prisma.workflow.create` — no phantom row.
    expect(await prisma.workflow.count()).toBe(before);
  });

  it('blocks activation when the stored definition has zero triggers (400, no write)', async () => {
    // Fixture workflow A ships with an empty `triggers: []` definition.
    await expect(
      svc.update(fixture.orgA.id, fixture.orgA.workflowId, { isActive: true }),
    ).rejects.toThrow(/no trigger/);

    // Gate runs before the updateMany — the row stays paused.
    const row = await prisma.workflow.findUniqueOrThrow({
      where: { id: fixture.orgA.workflowId },
    });
    expect(row.isActive).toBe(false);
  });

  it('blocks activation when the incoming definition carries two triggers', async () => {
    await expect(
      svc.update(fixture.orgA.id, fixture.orgA.workflowId, {
        isActive: true,
        definition: twoTriggerDefinition(fixture.orgA.connectionId),
      }),
    ).rejects.toThrow(/only one is allowed/);

    const row = await prisma.workflow.findUniqueOrThrow({
      where: { id: fixture.orgA.workflowId },
    });
    expect(row.isActive).toBe(false);
  });

  it('activates a single-trigger definition — flips isActive to true', async () => {
    const updated = await svc.update(fixture.orgA.id, fixture.orgA.workflowId, {
      isActive: true,
      definition: pollingDefinition(fixture.orgA.connectionId),
    });

    expect(updated.isActive).toBe(true);
    const row = await prisma.workflow.findUniqueOrThrow({
      where: { id: fixture.orgA.workflowId },
    });
    expect(row.isActive).toBe(true);
  });

  it('duplicate clones a paused "(copy)" row carrying definition + webhookSecret', async () => {
    // Give the source a definition + an encrypted webhook secret to clone.
    const def = pollingDefinition(fixture.orgA.connectionId);
    await prisma.workflow.update({
      where: { id: fixture.orgA.workflowId },
      data: { definition: def, webhookSecret: 'cipher-source-secret' },
    });

    const copy = await svc.duplicate(fixture.orgA.id, fixture.orgA.workflowId);

    expect(copy.id).not.toBe(fixture.orgA.workflowId);
    expect(copy.name).toBe('A workflow (copy)');
    // Duplicate starts paused so it doesn't fire before the user reviews it.
    expect(copy.isActive).toBe(false);
    // Definition + secret are carried over verbatim.
    expect(copy.definition).toEqual(def);
    expect(copy.webhookSecret).toBe('cipher-source-secret');
  });
});

function pollingDefinition(connectionId: string) {
  return {
    triggers: [
      {
        id: 'trigger_1',
        name: 'Trigger1',
        platform: 'github' as const,
        connectionId,
        type: 'issues' as const,
        intervalSec: 60,
        filters: [],
      },
    ],
    nodes: [],
    edges: [],
    mcpServers: [],
    ui: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
  };
}

/** Two polling triggers sharing one connection — valid def, but not activatable. */
function twoTriggerDefinition(connectionId: string) {
  return {
    triggers: [
      {
        id: 'trigger_1',
        name: 'Trigger1',
        platform: 'github' as const,
        connectionId,
        type: 'issues' as const,
        intervalSec: 60,
        filters: [],
      },
      {
        id: 'trigger_2',
        name: 'Trigger2',
        platform: 'github' as const,
        connectionId,
        type: 'pull_requests' as const,
        intervalSec: 60,
        filters: [],
      },
    ],
    nodes: [],
    edges: [],
    mcpServers: [],
    ui: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
  };
}

/**
 * A webhook trigger on an event that carries no issue/PR identifier — fails
 * `validateWorkflowDefinition` with `trigger-requires-issue-or-pr`, which the
 * service re-throws as a 400.
 */
function badWebhookDefinition(connectionId: string) {
  return {
    triggers: [
      {
        id: 'trigger_1',
        name: 'Trigger1',
        platform: 'github' as const,
        connectionId,
        type: 'webhook' as const,
        event: 'star.created',
        filters: [],
      },
    ],
    nodes: [],
    edges: [],
    mcpServers: [],
    ui: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
  };
}

interface DeleteCall {
  workflowId: string;
  slug?: string;
}

function recordingTemporal(upserts: WorkflowScheduleOptions[], deletes: DeleteCall[]) {
  return {
    upsertWorkflowSchedule: async (opts: WorkflowScheduleOptions) => {
      upserts.push(opts);
    },
    deleteWorkflowSchedule: async (workflowId: string, slug?: string) => {
      deletes.push({ workflowId, slug });
    },
    cancelAgentWorkflow: async () => undefined,
    startAgentWorkflow: async () => ({
      temporalWorkflowId: 'fake-tw',
      temporalRunId: 'fake-run',
    }),
  };
}
