import fs from 'node:fs/promises';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import {
  collectTemplatePlaceholders,
  templateFileSchema,
  type TemplateFile,
} from '@conduit/shared';

/**
 * Resolve the on-disk templates directory. Override with
 * `CONDUIT_TEMPLATES_DIR` for tests; defaults to `/templates` at the repo
 * root, discovered by walking up from `apps/api/dist` (prod) or
 * `apps/api/src` (dev).
 */
function resolveTemplatesDir(): string {
  const override = process.env.CONDUIT_TEMPLATES_DIR;
  if (override) return path.resolve(override);
  // __dirname at runtime is either .../apps/api/dist/modules/templates or
  // .../apps/api/src/modules/templates; both are 5 levels below the repo root.
  return path.resolve(__dirname, '../../../../..', 'templates');
}

export interface LoadedTemplate {
  file: TemplateFile;
  placeholders: string[];
}

/**
 * Reads every `*.json` in the templates directory, validates against the
 * Zod schema, logs + skips bad files. Called once at boot and cached for
 * the life of the process. Editing a template file on disk requires an
 * API restart to take effect — that's the v1 deal.
 */
export async function loadTemplates(logger: Logger): Promise<LoadedTemplate[]> {
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

  const loaded: LoadedTemplate[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.json')) continue;
    const filepath = path.join(dir, entry);
    try {
      const raw = await fs.readFile(filepath, 'utf8');
      const parsed = templateFileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        logger.warn(
          `Template ${entry} failed validation — skipping (${parsed.error.issues
            .map((i: { path: (string | number)[]; message: string }) =>
              `${i.path.join('.')}: ${i.message}`,
            )
            .join('; ')})`,
        );
        continue;
      }
      loaded.push({
        file: parsed.data,
        placeholders: collectTemplatePlaceholders(parsed.data),
      });
    } catch (err) {
      logger.warn(`Template ${entry} failed to load — skipping (${String(err)})`);
    }
  }
  return loaded;
}
