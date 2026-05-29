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

const FRAGMENT_NAME_RE = /^[a-z0-9-]+$/;
const INCLUDE_DIRECTIVE_RE = /\{\{include:([a-z0-9-]+)\}\}/g;

export async function resolveFragments(
  content: string,
  presetsDir: string,
  logger: Logger,
): Promise<string | null> {
  const matches = [...content.matchAll(INCLUDE_DIRECTIVE_RE)];
  if (matches.length === 0) return content;

  let resolved = content;
  const fragmentsDir = path.join(presetsDir, 'fragments');

  for (const match of matches) {
    const name = match[1];
    if (!FRAGMENT_NAME_RE.test(name)) {
      logger.warn(`Fragment name "${name}" is invalid — skipping preset`);
      return null;
    }

    const fragmentPath = path.resolve(fragmentsDir, `${name}.md`);
    if (!fragmentPath.startsWith(fragmentsDir + path.sep)) {
      logger.warn(`Fragment "${name}" resolves outside fragments dir — skipping preset`);
      return null;
    }

    try {
      const fragment = await fs.readFile(fragmentPath, 'utf8');
      resolved = resolved.replace(match[0], fragment.trim());
    } catch {
      logger.warn(`Fragment "${name}" not found at ${fragmentPath} — skipping preset`);
      return null;
    }
  }

  return resolved;
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
        const expanded = await resolveFragments(content, dir, logger);
        if (expanded === null) {
          logger.warn(`Agent preset ${entry} has unresolvable fragment — skipping`);
          return null;
        }
        const merged = { ...data, instructions: expanded.trim() };
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
