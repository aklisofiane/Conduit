import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { PrismaClient } from '@conduit/database';
import { workflowToTemplate, type WorkflowDefinition } from '@conduit/shared';
import { TemplatesService } from '../../src/modules/templates/templates.service';
import { importTemplateDtoSchema } from '../../src/modules/templates/dto';
import type { PrismaService } from '../../src/common/prisma.service';
import type { TemporalService } from '../../src/temporal/temporal.service';
import type { AgentPresetsService } from '../../src/modules/agent-presets/agent-presets.service';
import { seedTwoOrgs, type TwoOrgFixture } from '../../../../test/fixtures/orgs/two-orgs';
import { clearTenantData, makePrisma } from './setup';

/**
 * `POST /workflows/import` instantiates an uploaded bundle through the same
 * core as the catalog path: bindings re-ground placeholders in the importer's
 * org, the resolved definition is validated, and the workflow is persisted
 * paused. These tests drive the service method the controller delegates to.
 */
describe('TemplatesService.importTemplate', () => {
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

  it('round-trips an exported bundle: import re-grounds the placeholder in the org', async () => {
    // Build the bundle the way the web app does — export a live definition.
    const file = workflowToTemplate(
      { name: 'Imported Flow', definition: liveDefinition('conn_repo') },
      { aliasFor: () => 'repo' },
    );
    expect(file.category).toBe('custom');

    const created = await svc.importTemplate(fixture.orgA.id, {
      template: file,
      bindings: { repo: { mode: 'existing', connectionId: fixture.orgA.connectionId } },
    });

    expect(created.templateId).toBe('imported-flow');
    expect(created.workflows).toHaveLength(1);
    const definition = await loadDefinition(prisma, created.workflows[0]!.id);
    expect(definition.triggers[0].connectionId).toBe(fixture.orgA.connectionId);
  });

  it('rejects a bundle whose placeholder has no binding', async () => {
    const file = workflowToTemplate(
      { name: 'Needs Binding', definition: liveDefinition('conn_repo') },
      { aliasFor: () => 'repo' },
    );
    await expect(
      svc.importTemplate(fixture.orgA.id, { template: file, bindings: {} }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an existing-connection binding that belongs to another org', async () => {
    const file = workflowToTemplate(
      { name: 'Cross Org', definition: liveDefinition('conn_repo') },
      { aliasFor: () => 'repo' },
    );
    await expect(
      svc.importTemplate(fixture.orgA.id, {
        template: file,
        // orgB's connection is invisible to orgA — reported as unknown.
        bindings: { repo: { mode: 'existing', connectionId: fixture.orgB.connectionId } },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a bundle that smuggles a literal connection id past the placeholders', async () => {
    // A genuine export only emits <alias> placeholders; a hand-crafted bundle
    // could embed a concrete (possibly cross-org) id that resolveTemplate would
    // never re-ground. Build a valid export, then poke a literal id back in.
    const file = workflowToTemplate(
      { name: 'Smuggled', definition: liveDefinition('conn_repo') },
      { aliasFor: () => 'repo' },
    );
    file.workflows[0]!.definition.triggers[0]!.connectionId =
      fixture.orgB.connectionId;
    await expect(
      svc.importTemplate(fixture.orgA.id, { template: file, bindings: {} }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('schema-rejects JSON that is not a valid workflow export', () => {
    const result = importTemplateDtoSchema.safeParse({
      template: { not: 'a template' },
      bindings: {},
    });
    expect(result.success).toBe(false);
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

async function loadDefinition(prisma: PrismaClient, workflowId: string) {
  const wf = await prisma.workflow.findUniqueOrThrow({
    where: { id: workflowId },
    select: { definition: true },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return wf.definition as any;
}
