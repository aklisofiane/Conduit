import fs from 'node:fs/promises';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import {
  agentPresetFileSchema,
  type AgentPresetFile,
} from '@conduit/shared';

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
      `Agent-presets dir ${dir} not readable — no presets will be served (${String(err)})`,
    );
    return [];
  }

  const jsonFiles = entries.filter((e) => e.endsWith('.json')).sort();
  const loaded = await Promise.all(
    jsonFiles.map((entry) => loadOne(dir, entry, logger)),
  );
  return loaded.filter((t): t is AgentPresetFile => t !== null);
}

async function loadOne(
  dir: string,
  entry: string,
  logger: Logger,
): Promise<AgentPresetFile | null> {
  const filepath = path.join(dir, entry);
  try {
    const raw = await fs.readFile(filepath, 'utf8');
    const parsed = agentPresetFileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      logger.warn(
        `Agent preset ${entry} failed validation — skipping (${parsed.error.issues
          .map((i: { path: (string | number)[]; message: string }) =>
            `${i.path.join('.')}: ${i.message}`,
          )
          .join('; ')})`,
      );
      return null;
    }
    return parsed.data;
  } catch (err) {
    logger.warn(`Agent preset ${entry} failed to load — skipping (${String(err)})`);
    return null;
  }
}
