import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  buildAnalysisTriggerEvent,
  errorMessage,
  platformForScopeKind,
  type AssemblyPresets,
  type ConnectionScope,
  type TriggerSource,
  type WorkflowDefinition,
} from '@conduit/shared';
import { splitProjectPath } from '@conduit/shared/platform';
import type { Prisma } from '@conduit/database';
import { PrismaService } from '../../common/prisma.service';
import { TemporalService } from '../../temporal/temporal.service';
import { AgentPresetsService } from '../agent-presets/agent-presets.service';
import { ConnectionsService } from './connections.service';

const SYSTEM_WORKFLOW_NAME = 'Conduit System (analysis)';

/**
 * Trivially-valid stub definition for the per-org hidden SYSTEM workflow.
 * `assertValidWorkflowDefinition` imposes no minimum node count and zero
 * triggers is legal, so this satisfies the schema while the row exists only
 * to host internal analysis runs via the `WorkflowRun → Workflow` FK.
 */
const SYSTEM_STUB_DEFINITION: WorkflowDefinition = {
  triggers: [],
  nodes: [],
  edges: [],
  mcpServers: [],
  ui: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
};

/** Shape the connection card / suggestions gallery polls. */
export interface AnalysisView {
  id: string;
  status: string;
  phase: string;
  resultBundle: unknown;
  droppedComponents: unknown;
  error: string | null;
  importedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Owns the connection-scoped analyze action: minting the hidden internal run,
 * starting `repoAnalysisWorkflow`, and serving the latest analysis for the
 * badge / gallery. The internal run hangs off a per-org hidden SYSTEM workflow
 * so it never surfaces in the user's run history.
 */
@Injectable()
export class ConnectionAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: ConnectionsService,
    private readonly temporal: TemporalService,
    private readonly presets: AgentPresetsService,
  ) {}

  async analyze(orgId: string, connectionId: string): Promise<{ analysisId: string }> {
    // 404 (not 403) for a cross-org id — never confirm a sibling org's row.
    const connection = await this.connections.get(orgId, connectionId);
    const repo = repoFromScope(connection.scope);
    const platform = platformForScopeKind(connection.scope.kind);
    if (!repo || !platform) {
      throw new BadRequestException('Connection is not repo-scoped — nothing to analyze');
    }

    const triggerEvent = buildAnalysisTriggerEvent({ platform: platform as TriggerSource, repo });
    const presets = this.assemblyPresets();

    // Mint the internal run + analysis under a per-connection advisory lock so
    // the in-progress guard is atomic: two racing analyze() calls serialize,
    // and the second sees the first's PENDING row → 409 (a plain findFirst +
    // create would let both pass the check and double-analyze the repo).
    const minted = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${connectionId}, 0))`;
      const running = await tx.repoAnalysis.findFirst({
        where: { connectionId, status: { in: ['PENDING', 'ANALYZING'] } },
        select: { id: true },
      });
      if (running) {
        throw new ConflictException('An analysis is already in progress for this connection');
      }
      const systemWorkflowId = await ensureSystemWorkflow(tx, orgId);
      const internalRun = await tx.workflowRun.create({
        data: {
          orgId,
          workflowId: systemWorkflowId,
          status: 'RUNNING',
          trigger: triggerEvent as unknown as object,
        },
        select: { id: true },
      });
      const analysis = await tx.repoAnalysis.create({
        data: {
          orgId,
          connectionId,
          status: 'PENDING',
          phase: 'DISCOVER',
          internalRunId: internalRun.id,
        },
        select: { id: true },
      });
      return { systemWorkflowId, internalRunId: internalRun.id, analysisId: analysis.id };
    });

    // Only a *start* failure tears down — the workflow isn't running yet. A
    // post-start persistence hiccup must NOT fail an analysis that's already
    // executing, so the id write below is best-effort.
    let ids: { temporalWorkflowId: string; temporalRunId: string };
    try {
      ids = await this.temporal.startRepoAnalysisWorkflow({
        analysisId: minted.analysisId,
        internalRunId: minted.internalRunId,
        systemWorkflowId: minted.systemWorkflowId,
        orgId,
        connectionId,
        triggerEvent,
        presets,
      });
    } catch (err) {
      // A *lost* start response throws here even though the workflow actually
      // started server-side. Tearing the row down then would mark a live
      // analysis FAILED and — because the in-progress guard only blocks
      // PENDING/ANALYZING — let a second analyze() launch a duplicate run on
      // the same repo. So confirm the workflow isn't really running first.
      const live = await this.temporal
        .describeRunningRepoAnalysis(minted.analysisId)
        .catch(() => null);
      if (live) {
        await this.prisma.workflowRun
          .update({
            where: { id: minted.internalRunId },
            data: { temporalWorkflowId: live.temporalWorkflowId, temporalRunId: live.temporalRunId },
          })
          .catch(() => undefined);
        return { analysisId: minted.analysisId };
      }
      // Genuine start failure — tear down both rows in one transaction so we
      // never strand the internal run RUNNING while the analysis is FAILED
      // (a half-applied teardown would leave an unreconcilable phantom run).
      const message = errorMessage(err);
      await this.prisma.$transaction([
        this.prisma.repoAnalysis.update({
          where: { id: minted.analysisId },
          data: { status: 'FAILED', error: message },
        }),
        this.prisma.workflowRun.update({
          where: { id: minted.internalRunId },
          data: { status: 'FAILED', error: message, finishedAt: new Date() },
        }),
      ]);
      throw err;
    }
    await this.prisma.workflowRun
      .update({
        where: { id: minted.internalRunId },
        data: { temporalWorkflowId: ids.temporalWorkflowId, temporalRunId: ids.temporalRunId },
      })
      .catch(() => undefined);

    return { analysisId: minted.analysisId };
  }

  async getAnalysis(orgId: string, connectionId: string): Promise<AnalysisView | null> {
    await this.connections.assertInOrg(orgId, connectionId);
    const row = await this.prisma.repoAnalysis.findFirst({
      where: { orgId, connectionId },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return null;
    return {
      id: row.id,
      status: row.status,
      phase: row.phase,
      resultBundle: row.resultBundle,
      droppedComponents: row.droppedComponents,
      error: row.error,
      importedAt: row.importedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Stamp `importedAt` once the user imports an analysis's suggestions, so the
   * gallery / pill reflect "already imported" across reloads and re-opening the
   * gallery can't silently create duplicate workflows. Scoped by org +
   * connection + READY via `updateMany` so a cross-org or stale id is a no-op
   * (never a cross-tenant write), and idempotent on repeat calls.
   */
  async markImported(
    orgId: string,
    connectionId: string,
    analysisId: string,
  ): Promise<void> {
    await this.connections.assertInOrg(orgId, connectionId);
    await this.prisma.repoAnalysis.updateMany({
      where: { id: analysisId, orgId, connectionId, status: 'READY' },
      data: { importedAt: new Date() },
    });
  }

  private assemblyPresets(): AssemblyPresets {
    const toPreset = (id: string) => {
      const p = this.presets.get(id);
      return { provider: p.provider, model: p.model, instructions: p.instructions };
    };
    return {
      scope: toPreset('scope'),
      codeAnalyst: toPreset('code-analyst'),
      issuePublisher: toPreset('issue-publisher'),
    };
  }

}

/**
 * Lazily create the org's single hidden SYSTEM workflow. Runs inside the
 * analyze transaction (holding the per-connection advisory lock), so a
 * concurrent double-create on the same connection can't happen; a cross-
 * connection double-create is still harmless — both rows are SYSTEM-kind and
 * filtered out of every user-facing path, and internal runs FK to whichever.
 */
async function ensureSystemWorkflow(
  tx: Prisma.TransactionClient,
  orgId: string,
): Promise<string> {
  const existing = await tx.workflow.findFirst({
    where: { orgId, kind: 'SYSTEM' },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await tx.workflow.create({
    data: {
      orgId,
      kind: 'SYSTEM',
      name: SYSTEM_WORKFLOW_NAME,
      isActive: false,
      definition: SYSTEM_STUB_DEFINITION as unknown as object,
    },
    select: { id: true },
  });
  return created.id;
}

/** Extract `{ owner, name }` from a repo-scoped connection, or null otherwise. */
function repoFromScope(
  scope: ConnectionScope,
): { owner: string; name: string } | null {
  if (scope.kind === 'github_repo') return { owner: scope.owner, name: scope.repo };
  if (scope.kind === 'gitlab_project') return splitProjectPath(scope.projectPath);
  return null;
}
