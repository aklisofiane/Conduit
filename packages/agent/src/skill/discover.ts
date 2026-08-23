import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentProviderId, SkillProviderTag } from '@conduit/shared';
import { discoverPluginSkillRoots } from './plugins';

/**
 * A skill discovered on disk via its `SKILL.md` front-matter. Kept flat so
 * both the API (for `GET /skills`) and the worker (for copy-into-workspace)
 * consume the same shape.
 */
export interface DiscoveredSkill {
  /** Stable identifier — defaults to the directory name unless front-matter says otherwise. */
  id: string;
  name: string;
  description: string;
  /** Absolute path to the directory containing `SKILL.md`. */
  path: string;
  /** Where the skill was discovered — `repo` (inside a user repo) or `worker` (host-level). */
  source: 'repo' | 'worker';
  /** Which provider's directory convention picked this up. */
  provider: SkillProviderTag;
  /**
   * Display bucket the UI groups by — a plugin name (e.g. `vercel`), or the
   * synthetic `Worker` / `Repo` groups for loose `.claude/skills` dirs.
   */
  group: string;
  /** Marketplace a plugin skill came from (e.g. `claude-plugins-official`). */
  marketplace?: string;
}

/** Synthetic group labels for skills that don't belong to a plugin. */
const WORKER_GROUP = 'Worker';
const REPO_GROUP = 'Repo';

export interface DiscoverOptions {
  /** Extra repo paths to scan (e.g. the workspace of a currently-selected connection). */
  repoRoots?: string[];
  /** Defaults to the current working directory. */
  cwd?: string;
}

const WORKER_ROOTS = [
  { dir: '.claude/skills', provider: 'claude' as const },
  { dir: '.agents/skills', provider: 'codex' as const },
];
const REPO_ROOTS = [
  { dir: '.claude/skills', provider: 'claude' as const },
  { dir: '.agents/skills', provider: 'codex' as const },
];

export async function discoverSkills(opts: DiscoverOptions = {}): Promise<DiscoveredSkill[]> {
  const out: DiscoveredSkill[] = [];
  const seen = new Map<string, DiscoveredSkill>();
  const roots: Array<{
    base: string;
    source: 'repo' | 'worker';
    provider: AgentProviderId;
    group: string;
    marketplace?: string;
  }> = [];

  const home = os.homedir();
  for (const r of WORKER_ROOTS) {
    roots.push({
      base: path.join(home, r.dir),
      source: 'worker',
      provider: r.provider,
      group: WORKER_GROUP,
    });
  }

  // Enabled Claude Code plugins each ship a `skills/` dir at the host level.
  // They're Claude-convention and host-scoped, so they tag as worker/claude
  // and dedup against `~/.claude/skills` by the shared `${source}:${id}` key.
  for (const r of await discoverPluginSkillRoots(home)) {
    roots.push({
      base: r.base,
      source: 'worker',
      provider: 'claude',
      group: r.plugin,
      marketplace: r.marketplace,
    });
  }

  const repos = [opts.cwd ?? process.cwd(), ...(opts.repoRoots ?? [])];
  for (const repo of repos) {
    for (const r of REPO_ROOTS) {
      roots.push({
        base: path.join(repo, r.dir),
        source: 'repo',
        provider: r.provider,
        group: REPO_GROUP,
      });
    }
  }

  for (const root of roots) {
    const skills = await scanRoot(
      root.base,
      root.source,
      root.provider,
      root.group,
      root.marketplace,
    );
    for (const skill of skills) {
      const key = `${skill.source}:${skill.id}`;
      const existing = seen.get(key);
      if (existing && existing.provider !== skill.provider) {
        existing.provider = 'both';
        continue;
      }
      if (!existing) {
        seen.set(key, skill);
        out.push(skill);
      }
    }
  }
  return out;
}

/** Frontmatter rarely exceeds a few hundred bytes; cap the read so a giant
 * SKILL.md doesn't get fully loaded into memory just to list skills. */
const FRONT_MATTER_READ_BYTES = 2048;

async function scanRoot(
  base: string,
  source: 'repo' | 'worker',
  provider: AgentProviderId,
  group: string,
  marketplace: string | undefined,
): Promise<DiscoveredSkill[]> {
  const entries = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
  const dirs = entries.filter((e) => e.isDirectory());
  const results = await Promise.all(
    dirs.map(async (entry): Promise<DiscoveredSkill | undefined> => {
      const dir = path.join(base, entry.name);
      const head = await readFileHead(path.join(dir, 'SKILL.md'), FRONT_MATTER_READ_BYTES);
      if (head === undefined) return undefined;
      const meta = parseFrontMatter(head);
      return {
        id: meta.name ?? entry.name,
        name: meta.name ?? entry.name,
        description: meta.description ?? '',
        path: dir,
        source,
        provider,
        group,
        marketplace,
      };
    }),
  );
  return results.filter((s): s is DiscoveredSkill => s !== undefined);
}

async function readFileHead(file: string, bytes: number): Promise<string | undefined> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(file, 'r');
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.slice(0, bytesRead).toString('utf8');
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function parseFrontMatter(src: string): { name?: string; description?: string } {
  if (!src.startsWith('---')) return {};
  const end = src.indexOf('\n---', 3);
  if (end === -1) return {};
  const block = src.slice(3, end);
  const out: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    let value = m[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return { name: out['name'], description: out['description'] };
}
