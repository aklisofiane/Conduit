import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { PrismaClient } from '@conduit/database';
import {
  collectTemplatePlaceholderDetails,
  findMcpPreset,
  type TemplateFile,
} from '@conduit/shared';
import { TemplatesService } from '../../src/modules/templates/templates.service';
import type { PrismaService } from '../../src/common/prisma.service';
import type { TemporalService } from '../../src/temporal/temporal.service';
import type { AgentPresetsService } from '../../src/modules/agent-presets/agent-presets.service';
import type { LoadedTemplate } from '../../src/modules/templates/template-loader';
import { seedTwoOrgs, type TwoOrgFixture } from '../../../../test/fixtures/orgs/two-orgs';
import { clearTenantData, makePrisma } from './setup';

const GITHUB_PRESET = findMcpPreset('github')!;
const GITLAB_PRESET = findMcpPreset('gitlab')!;

/**
 * Preset-backed MCP servers must follow the bound connection's platform at
 * instantiation: a GitLab repo binding swaps the shipped GitHub transport for
 * the GitLab preset, a GitHub binding is a no-op, and a non-repo connection
 * is rejected at bind time instead of failing silently at runtime.
 */
describe('TemplatesService preset-backed MCP platform swap', () => {
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
    injectTemplate(svc, makeTemplate());
  });

  afterEach(async () => {
    await clearTenantData(prisma);
    await prisma.$disconnect();
  });

  it('swaps the GitHub preset transport for GitLab when a GitLab connection is bound', async () => {
    const conn = await createConnection(prisma, fixture.orgA.id, 'GITLAB', {
      kind: 'gitlab_project',
      projectPath: 'acme/app',
    });
    const created = await svc.createFromTemplate(fixture.orgA.id, 'swap-demo', {
      bindings: { repo: { mode: 'existing', connectionId: conn } },
    });
    const definition = await loadDefinition(prisma, created.workflows[0]!.id);
    expect(definition.mcpServers[0].presetId).toBe('gitlab');
    expect(definition.mcpServers[0].name).toBe(GITLAB_PRESET.name);
    expect(definition.mcpServers[0].transport).toEqual(GITLAB_PRESET.transport);
    expect(definition.triggers[0].platform).toBe('gitlab');
  });

  it('keeps the GitHub preset transport when a GitHub connection is bound', async () => {
    const created = await svc.createFromTemplate(fixture.orgA.id, 'swap-demo', {
      bindings: { repo: { mode: 'existing', connectionId: fixture.orgA.connectionId } },
    });
    const definition = await loadDefinition(prisma, created.workflows[0]!.id);
    expect(definition.mcpServers[0].presetId).toBe('github');
    expect(definition.mcpServers[0].transport).toEqual(GITHUB_PRESET.transport);
    expect(definition.triggers[0].platform).toBe('github');
  });

  it('rejects a non-repo connection on a preset-backed slot at bind time', async () => {
    const conn = await createConnection(prisma, fixture.orgA.id, 'SLACK', {
      kind: 'none',
    });
    await expect(
      svc.createFromTemplate(fixture.orgA.id, 'swap-demo', {
        bindings: { repo: { mode: 'existing', connectionId: conn } },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

function makeTemplate(): TemplateFile {
  return {
    id: 'swap-demo',
    name: 'Swap Demo',
    description: 'preset-backed mcp server swap fixture',
    category: 'triage',
    workflows: [
      {
        name: 'A',
        definition: {
          triggers: [
            {
              id: 'trigger-1',
              name: 'Trigger1',
              platform: 'github',
              connectionId: '<repo>',
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
              mcpServers: [{ serverId: 'platform-mcp' }],
              skills: [],
              webSearch: false,
            },
          ],
          edges: [{ from: 'Trigger1', to: 'A' }],
          mcpServers: [
            {
              id: 'platform-mcp',
              name: GITHUB_PRESET.name,
              transport: structuredClone(GITHUB_PRESET.transport),
              connectionId: '<repo>',
              presetId: 'github',
            },
          ],
          ui: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
        },
      },
    ],
  };
}

function injectTemplate(svc: TemplatesService, file: TemplateFile): void {
  const placeholderDetails = collectTemplatePlaceholderDetails(file);
  const loaded: LoadedTemplate = {
    file,
    placeholders: placeholderDetails.map((p) => p.alias),
    placeholderDetails,
  };
  (svc as unknown as { templates: Map<string, LoadedTemplate> }).templates.set(file.id, loaded);
}

async function createConnection(
  prisma: PrismaClient,
  orgId: string,
  platform: 'GITLAB' | 'SLACK',
  scope: object,
): Promise<string> {
  const cred = await prisma.credential.create({
    data: { orgId, platform, name: `${platform} creds`, secret: 'placeholder-ciphertext' },
  });
  const conn = await prisma.connection.create({
    data: { orgId, credentialId: cred.id, name: `${platform} conn`, scope },
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
