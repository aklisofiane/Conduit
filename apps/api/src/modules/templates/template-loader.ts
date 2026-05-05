import path from 'node:path';
import { Logger } from '@nestjs/common';
import {
  collectTemplatePlaceholders,
  expandTemplate,
  templateInputFileSchema,
  templateFileSchema,
  UnknownPresetError,
  type AgentPreset,
  type TemplateFile,
} from '@conduit/shared';
import { formatZodIssues, loadJsonDir } from '../../common/load-json-dir';

function resolveTemplatesDir(): string {
  const override = process.env.CONDUIT_TEMPLATES_DIR;
  if (override) return path.resolve(override);
  // __dirname at runtime is .../apps/api/{dist,src}/modules/templates — both
  // sit five levels below the repo root.
  return path.resolve(__dirname, '../../../../..', 'templates');
}

export interface LoadedTemplate {
  file: TemplateFile;
  placeholders: string[];
}

export type PresetResolver = (id: string) => AgentPreset | undefined;

export async function loadTemplates(
  logger: Logger,
  resolvePreset: PresetResolver,
): Promise<LoadedTemplate[]> {
  return loadJsonDir({
    dir: resolveTemplatesDir(),
    label: 'Template',
    logger,
    parse: (raw, entry) => parseTemplate(raw, entry, resolvePreset, logger),
  });
}

function parseTemplate(
  raw: unknown,
  entry: string,
  resolvePreset: PresetResolver,
  logger: Logger,
): LoadedTemplate | null {
  const inputParse = templateInputFileSchema.safeParse(raw);
  if (!inputParse.success) {
    logger.warn(
      `Template ${entry} failed input validation — skipping (${formatZodIssues(inputParse.error)})`,
    );
    return null;
  }

  let expanded: TemplateFile;
  try {
    expanded = expandTemplate(inputParse.data, resolvePreset);
  } catch (err) {
    if (err instanceof UnknownPresetError) {
      logger.warn(
        `Template ${entry} skipped — ${err.message} (preset not loaded or missing on disk)`,
      );
    } else {
      logger.warn(
        `Template ${entry} skipped — failed preset expansion (${String(err)})`,
      );
    }
    return null;
  }

  const runtimeParse = templateFileSchema.safeParse(expanded);
  if (!runtimeParse.success) {
    logger.warn(
      `Template ${entry} failed post-expansion validation — skipping (${formatZodIssues(runtimeParse.error)})`,
    );
    return null;
  }

  return {
    file: runtimeParse.data,
    placeholders: collectTemplatePlaceholders(runtimeParse.data),
  };
}
