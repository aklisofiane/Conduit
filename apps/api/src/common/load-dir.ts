import fs from 'node:fs/promises';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import type { ZodError } from 'zod';

export function formatZodIssues(error: ZodError): string {
  return error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
}

export interface LoadDirOpts<T> {
  dir: string;
  /** File extension to load, including the leading dot (e.g. ".json", ".md"). */
  ext: string;
  /** Human-readable label used in log messages (e.g. "Template", "Agent preset"). */
  label: string;
  logger: Logger;
  /**
   * Per-file parser, receiving the raw file contents (JSON.parse / front-matter
   * parsing belongs here). Return the loaded value, or `null` to skip the file
   * silently. Throw to skip with a logged warning.
   */
  parse: (raw: string, entry: string) => T | null;
}

/**
 * Load every `ext` file in `dir` through `parse`, tolerating a missing dir and
 * per-file failures (logged + skipped). The shared skeleton behind the
 * template and agent-preset loaders — each supplies its own `ext` + `parse`.
 */
export async function loadDir<T>({ dir, ext, label, logger, parse }: LoadDirOpts<T>): Promise<T[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    logger.warn(`${label}s dir ${dir} not readable — nothing will be served (${String(err)})`);
    return [];
  }

  const files = entries.filter((e) => e.endsWith(ext)).sort();
  const results: (T | null)[] = await Promise.all(
    files.map(async (entry) => {
      const filepath = path.join(dir, entry);
      try {
        return parse(await fs.readFile(filepath, 'utf8'), entry);
      } catch (err) {
        logger.warn(`${label} ${entry} failed to load — skipping (${String(err)})`);
        return null;
      }
    }),
  );
  return results.filter((t): t is T => t !== null);
}
