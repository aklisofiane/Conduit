import path from 'node:path';
import { Logger } from '@nestjs/common';
import matter from 'gray-matter';
import { agentPresetFileSchema, type AgentPresetFile } from '@conduit/shared';
import { formatZodIssues, loadDir } from '../../common/load-dir';

function resolvePresetsDir(): string {
  const override = process.env.CONDUIT_AGENT_PRESETS_DIR;
  if (override) return path.resolve(override);
  return path.resolve(__dirname, '../../../../..', 'agent-presets');
}

export async function loadAgentPresets(logger: Logger): Promise<AgentPresetFile[]> {
  return loadDir({
    dir: resolvePresetsDir(),
    ext: '.md',
    label: 'Agent preset',
    logger,
    parse: (raw, entry) => {
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
    },
  });
}
