import fs from 'node:fs/promises';
import path from 'node:path';

/** A plugin's `skills/` dir plus the labels we group its skills under. */
export interface PluginSkillRoot {
  /** Absolute path to `<installPath>/skills`. */
  base: string;
  /** Plugin name (left of the `@` in the `installed_plugins.json` key). */
  plugin: string;
  /** Marketplace the plugin came from (right of the `@`), if any. */
  marketplace?: string;
}

/**
 * Resolve the `skills/` directories of the user's *enabled* Claude Code
 * plugins. Plugins keep their skills at `<installPath>/skills/<skill>/SKILL.md`
 * — the same `SKILL.md` shape `discover.ts` already parses — so once we know
 * each plugin's install path we hand the dir back to the normal scanner,
 * tagged with the plugin/marketplace the UI groups by.
 *
 * We mirror what Claude Code itself loads rather than globbing the cache:
 * - `installed_plugins.json` gives the authoritative `installPath` per plugin,
 *   so we pick the *installed* version and never the stale ones the cache keeps
 *   side-by-side.
 * - `settings.json`'s `enabledPlugins` map lets us drop plugins the user has
 *   explicitly disabled (value `false`) instead of surfacing hidden skills.
 *
 * Both files are Claude-internal; if either is missing or malformed we simply
 * return no roots (plugins stay invisible) rather than throwing — skill
 * discovery must never fail because the plugin layout shifted.
 */
export async function discoverPluginSkillRoots(home: string): Promise<PluginSkillRoot[]> {
  const pluginsDir = path.join(home, '.claude', 'plugins');
  const installed = await readJson(path.join(pluginsDir, 'installed_plugins.json'));
  const plugins = asRecord(installed?.['plugins']);
  if (!plugins) return [];

  const settings = await readJson(path.join(home, '.claude', 'settings.json'));
  const enabled = asRecord(settings?.['enabledPlugins']) ?? {};

  const roots: PluginSkillRoot[] = [];
  for (const [key, entries] of Object.entries(plugins)) {
    if (enabled[key] === false) continue;
    if (!Array.isArray(entries)) continue;
    const [plugin, marketplace] = splitPluginKey(key);
    for (const entry of entries) {
      const installPath = asRecord(entry)?.['installPath'];
      if (typeof installPath === 'string' && installPath.length > 0) {
        roots.push({ base: path.join(installPath, 'skills'), plugin, marketplace });
      }
    }
  }
  return roots;
}

/** `feature-flow@nohjen-marketplace` → `['feature-flow', 'nohjen-marketplace']`. */
function splitPluginKey(key: string): [plugin: string, marketplace: string | undefined] {
  const at = key.lastIndexOf('@');
  return at === -1 ? [key, undefined] : [key.slice(0, at), key.slice(at + 1)];
}

async function readJson(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    const text = await fs.readFile(file, 'utf8');
    const parsed: unknown = JSON.parse(text);
    return asRecord(parsed);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
