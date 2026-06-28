import fs from 'node:fs/promises';
import path from 'node:path';
import type { ZodType } from 'zod';
import {
  ANALYSIS_DRAFT_PATH,
  ANALYSIS_MANIFEST_PATH,
  componentManifestSchema,
  workflowDraftSchema,
  type ComponentManifest,
  type WorkflowDraft,
} from '@conduit/shared';
import { errorMessage } from '@conduit/shared/runtime';

/**
 * Read + Zod-validate one of the analyzer's JSON artifacts from a node's
 * workspace. Throws on any failure (missing file, bad JSON, schema mismatch)
 * so the caller's bounded-retry loop re-runs the agent — freeform output can't
 * be reliably parsed by orchestration code.
 */
async function readJsonArtifact<T>(
  workspacePath: string,
  relPath: string,
  schema: ZodType<T>,
): Promise<T> {
  const file = path.join(workspacePath, relPath);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    throw new Error(`analyzer did not write ${relPath}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${relPath} is not valid JSON: ${errorMessage(err)}`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`${relPath} failed validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function readComponentManifestActivity(input: {
  workspacePath: string;
}): Promise<ComponentManifest> {
  return readJsonArtifact(input.workspacePath, ANALYSIS_MANIFEST_PATH, componentManifestSchema);
}

export async function readWorkflowDraftActivity(input: {
  workspacePath: string;
}): Promise<WorkflowDraft> {
  return readJsonArtifact(input.workspacePath, ANALYSIS_DRAFT_PATH, workflowDraftSchema);
}
