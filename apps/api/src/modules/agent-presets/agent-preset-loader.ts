import path from 'node:path';
import { Logger } from '@nestjs/common';
import {
  agentPresetFileSchema,
  type AgentPresetFile,
} from '@conduit/shared';
import { formatZodIssues, loadJsonDir } from '../../common/load-json-dir';

function resolvePresetsDir(): string {
  const override = process.env.CONDUIT_AGENT_PRESETS_DIR;
  if (override) return path.resolve(override);
  return path.resolve(__dirname, '../../../../..', 'agent-presets');
}

export async function loadAgentPresets(logger: Logger): Promise<AgentPresetFile[]> {
  return loadJsonDir({
    dir: resolvePresetsDir(),
    label: 'Agent preset',
    logger,
    parse: (raw, entry) => {
      const parsed = agentPresetFileSchema.safeParse(raw);
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
