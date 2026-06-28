import type { AnalysisPhase, AnalysisStatus } from '@conduit/shared';
import { prisma } from '../runtime/prisma';

/**
 * Write the analysis progress signal. Called by `repoAnalysisWorkflow` at each
 * stage so the connection's progress card has a coarse phase/status without
 * reading hidden `NodeRun` rows. Also the terminal-failure writer (status
 * FAILED + error) — undefined fields are left untouched.
 */
export async function updateAnalysisPhaseActivity(input: {
  analysisId: string;
  phase?: AnalysisPhase;
  status?: AnalysisStatus;
  error?: string;
}): Promise<void> {
  await prisma().repoAnalysis.update({
    where: { id: input.analysisId },
    data: {
      phase: input.phase,
      status: input.status,
      error: input.error,
    },
  });
}
