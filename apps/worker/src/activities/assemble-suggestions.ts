import {
  assembleSuggestionBundle,
  type AssemblyPresets,
  type DroppedComponent,
  type TriggerSource,
  type WorkflowDraft,
} from '@conduit/shared';
import { prisma } from '../runtime/prisma';

export interface AssembleSuggestionsInput {
  analysisId: string;
  drafts: WorkflowDraft[];
  /** Components already dropped during Design fan-out. */
  dropped: DroppedComponent[];
  repo: { owner: string; name: string };
  platform: TriggerSource;
  defaultBranch: string;
  presets: AssemblyPresets;
}

/**
 * Pure-code Assemble step: stitch surviving `WorkflowDraft`s into one
 * validated multi-workflow `TemplateFile` and persist the terminal analysis
 * state on `RepoAnalysis`. Drops from Design fan-out and from Assemble
 * (drafts with no recognized domains) are merged into `droppedComponents`.
 * If nothing survives, the analysis is marked FAILED with a clear message.
 */
export async function assembleSuggestionsActivity(input: AssembleSuggestionsInput): Promise<void> {
  const { bundle, dropped: assembleDropped } = assembleSuggestionBundle(input.drafts, {
    repo: input.repo,
    platform: input.platform,
    defaultBranch: input.defaultBranch,
    presets: input.presets,
  });
  const dropped: DroppedComponent[] = [...input.dropped, ...assembleDropped];

  if (!bundle) {
    await prisma().repoAnalysis.update({
      where: { id: input.analysisId },
      data: {
        status: 'FAILED',
        error: 'Analysis produced no reviewable components.',
        droppedComponents: dropped as unknown as object,
      },
    });
    return;
  }

  await prisma().repoAnalysis.update({
    where: { id: input.analysisId },
    data: {
      status: 'READY',
      resultBundle: bundle as unknown as object,
      droppedComponents: dropped as unknown as object,
      error: null,
    },
  });
}
