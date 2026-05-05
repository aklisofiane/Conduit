import fs from 'node:fs/promises';
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

export async function loadTemplates(
  logger: Logger,
  presetMap: ReadonlyMap<string, AgentPreset>,
): Promise<LoadedTemplate[]> {
  const dir = resolveTemplatesDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    logger.warn(
      `Templates dir ${dir} not readable — no templates will be served (${String(err)})`,
    );
    return [];
  }

  const jsonFiles = entries.filter((e) => e.endsWith('.json')).sort();
  const loaded = await Promise.all(
    jsonFiles.map((entry) => loadOne(dir, entry, presetMap, logger)),
  );
  return loaded.filter((t): t is LoadedTemplate => t !== null);
}

async function loadOne(
  dir: string,
  entry: string,
  presetMap: ReadonlyMap<string, AgentPreset>,
  logger: Logger,
): Promise<LoadedTemplate | null> {
  const filepath = path.join(dir, entry);
  try {
    const raw = await fs.readFile(filepath, 'utf8');
    const inputParse = templateInputFileSchema.safeParse(JSON.parse(raw));
    if (!inputParse.success) {
      logger.warn(
        `Template ${entry} failed input validation — skipping (${inputParse.error.issues
          .map((i: { path: (string | number)[]; message: string }) =>
            `${i.path.join('.')}: ${i.message}`,
          )
          .join('; ')})`,
      );
      return null;
    }

    let expanded: TemplateFile;
    try {
      expanded = expandTemplate(inputParse.data, presetMap);
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
        `Template ${entry} failed post-expansion validation — skipping (${runtimeParse.error.issues
          .map((i: { path: (string | number)[]; message: string }) =>
            `${i.path.join('.')}: ${i.message}`,
          )
          .join('; ')})`,
      );
      return null;
    }

    return {
      file: runtimeParse.data,
      placeholders: collectTemplatePlaceholders(runtimeParse.data),
    };
  } catch (err) {
    logger.warn(`Template ${entry} failed to load — skipping (${String(err)})`);
    return null;
  }
}
