import fs from 'node:fs/promises';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import type { ZodError } from 'zod';

export function formatZodIssues(error: ZodError): string {
  return error.issues
    .map((i) => `${i.path.join('.')}: ${i.message}`)
    .join('; ');
}

export interface LoadJsonDirOpts<T> {
  dir: string;
  /** Human-readable label used in log messages (e.g. "Template", "Agent preset"). */
  label: string;
  logger: Logger;
  /**
   * Per-file parser. Return the loaded value, or `null` to skip the file
   * silently. Throw to bubble — callers typically log + return null instead.
   */
  parse: (raw: unknown, entry: string) => T | null;
}

export async function loadJsonDir<T>({
  dir,
  label,
  logger,
  parse,
}: LoadJsonDirOpts<T>): Promise<T[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    logger.warn(
      `${label}s dir ${dir} not readable — nothing will be served (${String(err)})`,
    );
    return [];
  }

  const jsonFiles = entries.filter((e) => e.endsWith('.json')).sort();
  const results: (T | null)[] = await Promise.all(
    jsonFiles.map(async (entry) => {
      const filepath = path.join(dir, entry);
      try {
        const raw = JSON.parse(await fs.readFile(filepath, 'utf8'));
        return parse(raw, entry);
      } catch (err) {
        logger.warn(`${label} ${entry} failed to load — skipping (${String(err)})`);
        return null;
      }
    }),
  );
  return results.filter((t): t is T => t !== null);
}
