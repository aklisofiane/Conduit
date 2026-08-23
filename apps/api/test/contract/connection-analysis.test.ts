import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@conduit/database';
import type { RepoAnalysisWorkflowInput } from '@conduit/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConnectionAnalysisService } from '../../src/modules/connections/connection-analysis.service';
import { ConnectionsService } from '../../src/modules/connections/connections.service';
import { WorkflowsService } from '../../src/modules/workflows/workflows.service';
import { AgentPresetsService } from '../../src/modules/agent-presets/agent-presets.service';
import type { PrismaService } from '../../src/common/prisma.service';
import type { TemporalService } from '../../src/temporal/temporal.service';
import { seedTwoOrgs, type TwoOrgFixture } from '../../../../test/fixtures/orgs/two-orgs';
import { clearTenantData } from './setup';

/**
 * Contract coverage for the connection analyze flow: minting the hidden
 * internal run, rejecting concurrent analyses, gating on repo scope + org,
 * and keeping the SYSTEM workflow out of user-facing lists.
 */
describe('ConnectionAnalysisService', () => {
  let prisma: PrismaClient;
  let fixture: TwoOrgFixture;
  let svc: ConnectionAnalysisService;
  let workflows: WorkflowsService;
  let connections: ConnectionsService;
  let presets: AgentPresetsService;
  const started: RepoAnalysisWorkflowInput[] = [];

  const fakeTemporal = {
    async startRepoAnalysisWorkflow(input: RepoAnalysisWorkflowInput) {
      started.push(input);
      return { temporalWorkflowId: `analysis-run-${input.analysisId}`, temporalRunId: 'run-1' };
    },
    async describeRunningRepoAnalysis() {
      return null;
    },
  } as unknown as TemporalService;

  beforeEach(async () => {
    prisma = new PrismaClient();
    started.length = 0;
    await clearTenantData(prisma);
    fixture = await seedTwoOrgs(prisma);
    presets = new AgentPresetsService();
    await presets.onModuleInit();
    connections = new ConnectionsService(prisma as unknown as PrismaService);
    svc = new ConnectionAnalysisService(
      prisma as unknown as PrismaService,
      connections,
      fakeTemporal,
      presets,
    );
    workflows = new WorkflowsService(prisma as unknown as PrismaService, fakeTemporal as never);
  });

  afterEach(async () => {
    await clearTenantData(prisma);
    await prisma.$disconnect();
  });

  it('mints an internal run + analysis row and starts the workflow', async () => {
    const { analysisId } = await svc.analyze(fixture.orgA.id, fixture.orgA.connectionId);

    const analysis = await prisma.repoAnalysis.findUnique({ where: { id: analysisId } });
    expect(analysis?.status).toBe('PENDING');
    expect(analysis?.connectionId).toBe(fixture.orgA.connectionId);

    // The internal run hangs off a SYSTEM-kind workflow.
    const internalRun = await prisma.workflowRun.findUnique({
      where: { id: analysis!.internalRunId },
      include: { workflow: true },
    });
    expect(internalRun?.workflow.kind).toBe('SYSTEM');
    expect(internalRun?.orgId).toBe(fixture.orgA.id);

    // The workflow was started with the matching analysis id.
    expect(started).toHaveLength(1);
    expect(started[0]!.analysisId).toBe(analysisId);
    expect(started[0]!.triggerEvent.event).toBe('analysis');
  });

  it('reuses one SYSTEM workflow per org and hides it from the workflow list', async () => {
    await svc.analyze(fixture.orgA.id, fixture.orgA.connectionId);
    const first = await prisma.repoAnalysis.findFirst({ where: { orgId: fixture.orgA.id } });
    // Force the first analysis terminal so a second is allowed.
    await prisma.repoAnalysis.update({ where: { id: first!.id }, data: { status: 'READY' } });
    await svc.analyze(fixture.orgA.id, fixture.orgA.connectionId);

    const systemWorkflows = await prisma.workflow.findMany({
      where: { orgId: fixture.orgA.id, kind: 'SYSTEM' },
    });
    expect(systemWorkflows).toHaveLength(1);

    const listed = await workflows.list(fixture.orgA.id);
    expect(listed.every((w) => w.kind === 'STANDARD')).toBe(true);
    expect(listed.some((w) => w.id === systemWorkflows[0]!.id)).toBe(false);
  });

  it('rejects a second analysis while one is in progress (409)', async () => {
    await svc.analyze(fixture.orgA.id, fixture.orgA.connectionId);
    await expect(svc.analyze(fixture.orgA.id, fixture.orgA.connectionId)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects a non-repo-scoped connection (400)', async () => {
    const boardConn = await prisma.connection.create({
      data: {
        orgId: fixture.orgA.id,
        credentialId: fixture.orgA.credentialId,
        name: 'A board',
        scope: { kind: 'github_projects_v2', ownerType: 'org', owner: 'orga', number: 1 },
      },
    });
    await expect(svc.analyze(fixture.orgA.id, boardConn.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('404s a cross-org connection without leaking existence', async () => {
    await expect(svc.analyze(fixture.orgA.id, fixture.orgB.connectionId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(started).toHaveLength(0);
  });

  it('getAnalysis returns the latest analysis for the connection', async () => {
    expect(await svc.getAnalysis(fixture.orgA.id, fixture.orgA.connectionId)).toBeNull();
    const { analysisId } = await svc.analyze(fixture.orgA.id, fixture.orgA.connectionId);
    const view = await svc.getAnalysis(fixture.orgA.id, fixture.orgA.connectionId);
    expect(view?.id).toBe(analysisId);
    expect(view?.status).toBe('PENDING');
  });

  it('reconciles a stranded ANALYZING row whose workflow is no longer running', async () => {
    const { analysisId } = await svc.analyze(fixture.orgA.id, fixture.orgA.connectionId);
    const before = await prisma.repoAnalysis.findUnique({ where: { id: analysisId } });
    await prisma.repoAnalysis.update({ where: { id: analysisId }, data: { status: 'ANALYZING' } });
    // Push it past the grace window — @updatedAt is auto-set, so backdate raw.
    await prisma.$executeRaw`UPDATE "RepoAnalysis" SET "updatedAt" = now() - interval '60 seconds' WHERE id = ${analysisId}`;

    // describeRunningRepoAnalysis returns null (default fake) → workflow is dead.
    const view = await svc.getAnalysis(fixture.orgA.id, fixture.orgA.connectionId);
    expect(view?.status).toBe('FAILED');
    expect(view?.error).toBeTruthy();

    // The hidden internal run is released, not left RUNNING.
    const run = await prisma.workflowRun.findUnique({ where: { id: before!.internalRunId } });
    expect(run?.status).toBe('FAILED');
    expect(run?.finishedAt).toBeInstanceOf(Date);

    // And a rerun is unblocked now the row is terminal.
    await expect(svc.analyze(fixture.orgA.id, fixture.orgA.connectionId)).resolves.toMatchObject({
      analysisId: expect.any(String),
    });
  });

  it('leaves a freshly-minted non-terminal row alone (start-race grace window)', async () => {
    const { analysisId } = await svc.analyze(fixture.orgA.id, fixture.orgA.connectionId);
    // Within the grace window, describe being not-found must NOT fail the row.
    const view = await svc.getAnalysis(fixture.orgA.id, fixture.orgA.connectionId);
    expect(view?.id).toBe(analysisId);
    expect(view?.status).toBe('PENDING');
  });

  it('does not reconcile a non-terminal row whose workflow is still RUNNING', async () => {
    const runningTemporal = {
      ...fakeTemporal,
      async startRepoAnalysisWorkflow(input: RepoAnalysisWorkflowInput) {
        started.push(input);
        return { temporalWorkflowId: `analysis-run-${input.analysisId}`, temporalRunId: 'run-1' };
      },
      async describeRunningRepoAnalysis(analysisId: string) {
        return { temporalWorkflowId: `analysis-run-${analysisId}`, temporalRunId: 'run-1' };
      },
    } as unknown as TemporalService;
    const runningSvc = new ConnectionAnalysisService(
      prisma as unknown as PrismaService,
      connections,
      runningTemporal,
      presets,
    );

    const { analysisId } = await runningSvc.analyze(fixture.orgA.id, fixture.orgA.connectionId);
    await prisma.repoAnalysis.update({ where: { id: analysisId }, data: { status: 'ANALYZING' } });
    await prisma.$executeRaw`UPDATE "RepoAnalysis" SET "updatedAt" = now() - interval '60 seconds' WHERE id = ${analysisId}`;

    const view = await runningSvc.getAnalysis(fixture.orgA.id, fixture.orgA.connectionId);
    expect(view?.status).toBe('ANALYZING');
  });

  it('markImported stamps a READY analysis and is reflected by getAnalysis', async () => {
    const { analysisId } = await svc.analyze(fixture.orgA.id, fixture.orgA.connectionId);
    await prisma.repoAnalysis.update({ where: { id: analysisId }, data: { status: 'READY' } });

    await svc.markImported(fixture.orgA.id, fixture.orgA.connectionId, analysisId);

    const view = await svc.getAnalysis(fixture.orgA.id, fixture.orgA.connectionId);
    expect(view?.importedAt).toBeInstanceOf(Date);
  });

  it('markImported never writes across orgs and only touches READY rows', async () => {
    const { analysisId } = await svc.analyze(fixture.orgA.id, fixture.orgA.connectionId);
    await prisma.repoAnalysis.update({ where: { id: analysisId }, data: { status: 'READY' } });

    // Wrong org → assertInOrg 404s, no write.
    await expect(
      svc.markImported(fixture.orgB.id, fixture.orgA.connectionId, analysisId),
    ).rejects.toBeInstanceOf(NotFoundException);

    // Right org but the row isn't READY → no-op (updateMany matches nothing).
    await prisma.repoAnalysis.update({ where: { id: analysisId }, data: { status: 'PENDING' } });
    await svc.markImported(fixture.orgA.id, fixture.orgA.connectionId, analysisId);
    const row = await prisma.repoAnalysis.findUnique({ where: { id: analysisId } });
    expect(row?.importedAt).toBeNull();
  });

  it('on a genuine start failure, fails both rows and rethrows the start error', async () => {
    const boom = new Error('temporal unreachable');
    const failingTemporal = {
      async startRepoAnalysisWorkflow() {
        throw boom;
      },
      async describeRunningRepoAnalysis() {
        return null; // not actually running → tear down
      },
    } as unknown as TemporalService;
    const failingSvc = new ConnectionAnalysisService(
      prisma as unknown as PrismaService,
      connections,
      failingTemporal,
      presets,
    );

    await expect(failingSvc.analyze(fixture.orgA.id, fixture.orgA.connectionId)).rejects.toBe(boom);

    const analysis = await prisma.repoAnalysis.findFirst({
      where: { connectionId: fixture.orgA.connectionId },
    });
    expect(analysis?.status).toBe('FAILED');
    const run = await prisma.workflowRun.findUnique({ where: { id: analysis!.internalRunId } });
    expect(run?.status).toBe('FAILED');
    expect(run?.finishedAt).toBeInstanceOf(Date);
  });

  it('keeps the analysis live when the start RPC was lost but the workflow is running', async () => {
    // start() throws (lost response) yet the workflow actually started → describe
    // reports RUNNING, so we must NOT tear the row down.
    const lostStartTemporal = {
      async startRepoAnalysisWorkflow() {
        throw new Error('connection reset');
      },
      async describeRunningRepoAnalysis(analysisId: string) {
        return { temporalWorkflowId: `analysis-run-${analysisId}`, temporalRunId: 'recovered-run' };
      },
    } as unknown as TemporalService;
    const recoveringSvc = new ConnectionAnalysisService(
      prisma as unknown as PrismaService,
      connections,
      lostStartTemporal,
      presets,
    );

    const { analysisId } = await recoveringSvc.analyze(fixture.orgA.id, fixture.orgA.connectionId);

    const analysis = await prisma.repoAnalysis.findUnique({ where: { id: analysisId } });
    expect(analysis?.status).toBe('PENDING'); // not failed
    const run = await prisma.workflowRun.findUnique({ where: { id: analysis!.internalRunId } });
    expect(run?.status).toBe('RUNNING');
    expect(run?.temporalRunId).toBe('recovered-run');
  });
});

// Quiet the Nest logger during preset load in tests.
Logger.overrideLogger(false);
