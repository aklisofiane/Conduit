import fs from 'node:fs/promises';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import matter from 'gray-matter';
import {
  agentPresetFileSchema,
  type AgentPresetFile,
} from '@conduit/shared';
import { formatZodIssues } from '../../common/load-json-dir';

function resolvePresetsDir(): string {
  const override = process.env.CONDUIT_AGENT_PRESETS_DIR;
  if (override) return path.resolve(override);
  return path.resolve(__dirname, '../../../../..', 'agent-presets');
}

export async function loadAgentPresets(logger: Logger): Promise<AgentPresetFile[]> {
  const dir = resolvePresetsDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    logger.warn(
      `Agent presets dir ${dir} not readable — nothing will be served (${String(err)})`,
    );
    return [];
  }

  const mdFiles = entries.filter((e) => e.endsWith('.md')).sort();
  const results = await Promise.all(
    mdFiles.map(async (entry): Promise<AgentPresetFile | null> => {
      const filepath = path.join(dir, entry);
      try {
        const raw = await fs.readFile(filepath, 'utf8');
        const { data, content } = matter(raw);
        const merged = { ...data, instructions: content.trim() };
        const parsed = agentPresetFileSchema.safeParse(merged);
        if (!parsed.success) {
          logger.warn(
            `Agent preset ${entry} failed validation — skipping (${formatZodIssues(parsed.error)})`,
          );
          return null;
        }
        return parsed.data;
      } catch (err) {
        logger.warn(
          `Agent preset ${entry} failed to load — skipping (${String(err)})`,
        );
        return null;
      }
    }),
  );

  return results.filter((r): r is AgentPresetFile => r !== null);
}
