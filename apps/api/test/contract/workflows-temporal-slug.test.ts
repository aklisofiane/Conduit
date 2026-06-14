import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@conduit/database';
import { buildTemporalSlug, type WorkflowScheduleOptions } from '@conduit/shared';
import { WorkflowsService } from '../../src/modules/workflows/workflows.service';
import type { PrismaService } from '../../src/common/prisma.service';
import type { TemporalService } from '../../src/temporal/temporal.service';
import { seedTwoOrgs, type TwoOrgFixture } from '../../../../test/fixtures/orgs/two-orgs';
import { clearTenantData, makePrisma } from './setup';

/**
 * Freeze contract for `Workflow.temporalSlug`. The slug is computed once from
 * the workflow name + its source connection name, persisted on first
 * materialization, and never recomputed afterwards — a rename leaves the
 * Temporal id (and the slug fed to the schedule) untouched.
 */
describe('WorkflowsService temporal-slug freeze', () => {
  let prisma: PrismaClient;
  let fixture: TwoOrgFixture;
  let upserts: WorkflowScheduleOptions[];
  let svc: WorkflowsService;

  beforeEach(async () => {
    prisma = makePrisma();
    await clearTenantData(prisma);
    fixture = await seedTwoOrgs(prisma);
    upserts = [];
    svc = new WorkflowsService(
      prisma as unknown as PrismaService,
      recordingTemporal(upserts) as unknown as TemporalService,
    );
  });

  afterEach(async () => {
    await clearTenantData(prisma);
    await prisma.$disconnect();
  });

  it('freezes <wf>-<conn> on create and feeds it to the schedule upsert', async () => {
    const created = await svc.create(fixture.orgA.id, {
      name: 'Slug Test WF',
      definition: pollingDefinition(fixture.orgA.connectionId),
    });

    // 'A repo' is the fixture connection name → slugs to 'a-repo'.
    const expected = buildTemporalSlug('Slug Test WF', 'A repo');
    expect(expected).toBe('slug-test-wf-a-repo');

    const row = await prisma.workflow.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.temporalSlug).toBe(expected);
    expect(upserts.at(-1)?.slug).toBe(expected);
  });

  it('keeps the frozen slug across a rename — id never shifts', async () => {
    const created = await svc.create(fixture.orgA.id, {
      name: 'Original Name',
      definition: pollingDefinition(fixture.orgA.connectionId),
    });
    const frozen = buildTemporalSlug('Original Name', 'A repo');
    expect(frozen).toBe('original-name-a-repo');

    await svc.update(fixture.orgA.id, created.id, { name: 'Renamed Entirely' });

    const row = await prisma.workflow.findUniqueOrThrow({ where: { id: created.id } });
    // Still the original slug, NOT buildTemporalSlug('Renamed Entirely', ...).
    expect(row.temporalSlug).toBe(frozen);
    // The rename's upsert re-keys the schedule on the frozen value.
    expect(upserts.at(-1)?.slug).toBe(frozen);
  });

  it('leaves temporalSlug null and slug undefined when no connection resolves', async () => {
    // Trigger references a deleted/unknown connection id → name only would
    // apply, but here the name itself is fine, so we get name-only slug.
    const created = await svc.create(fixture.orgA.id, {
      name: 'No Conn WF',
      definition: pollingDefinition('conn_does_not_exist'),
    });

    const expected = buildTemporalSlug('No Conn WF'); // name only
    expect(expected).toBe('no-conn-wf');
    const row = await prisma.workflow.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.temporalSlug).toBe(expected);
    expect(upserts.at(-1)?.slug).toBe(expected);
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

function recordingTemporal(upserts: WorkflowScheduleOptions[]) {
  return {
    upsertWorkflowSchedule: async (opts: WorkflowScheduleOptions) => {
      upserts.push(opts);
    },
    deleteWorkflowSchedule: async () => undefined,
    cancelAgentWorkflow: async () => undefined,
    startAgentWorkflow: async () => ({
      temporalWorkflowId: 'fake-tw',
      temporalRunId: 'fake-run',
    }),
  };
}
