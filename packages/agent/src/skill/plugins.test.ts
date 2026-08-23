import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverPluginSkillRoots } from './plugins';

describe('discoverPluginSkillRoots', () => {
  let home: string;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'conduit-plugins-'));
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  async function writeJson(rel: string, value: unknown): Promise<void> {
    const file = path.join(home, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(value), 'utf8');
  }

  it('returns the `skills` dir of each installed plugin tagged with plugin + marketplace', async () => {
    await writeJson('.claude/plugins/installed_plugins.json', {
      version: 2,
      plugins: {
        'feature-flow@nohjen': [{ scope: 'user', installPath: '/abs/feature-flow/0.3.7' }],
        'vercel@official': [{ scope: 'user', installPath: '/abs/vercel/0.44.0' }],
      },
    });

    const roots = await discoverPluginSkillRoots(home);

    expect(roots).toEqual([
      {
        base: path.join('/abs/feature-flow/0.3.7', 'skills'),
        plugin: 'feature-flow',
        marketplace: 'nohjen',
      },
      {
        base: path.join('/abs/vercel/0.44.0', 'skills'),
        plugin: 'vercel',
        marketplace: 'official',
      },
    ]);
  });

  it('tolerates a plugin key with no marketplace suffix', async () => {
    await writeJson('.claude/plugins/installed_plugins.json', {
      plugins: { local: [{ installPath: '/abs/local' }] },
    });

    const roots = await discoverPluginSkillRoots(home);

    expect(roots).toEqual([
      { base: path.join('/abs/local', 'skills'), plugin: 'local', marketplace: undefined },
    ]);
  });

  it('drops plugins explicitly disabled in settings.enabledPlugins', async () => {
    await writeJson('.claude/plugins/installed_plugins.json', {
      plugins: {
        'on@m': [{ installPath: '/abs/on' }],
        'off@m': [{ installPath: '/abs/off' }],
      },
    });
    await writeJson('.claude/settings.json', {
      enabledPlugins: { 'on@m': true, 'off@m': false },
    });

    const roots = await discoverPluginSkillRoots(home);

    expect(roots.map((r) => r.base)).toEqual([path.join('/abs/on', 'skills')]);
  });

  it('treats plugins absent from enabledPlugins as enabled', async () => {
    await writeJson('.claude/plugins/installed_plugins.json', {
      plugins: { 'unlisted@m': [{ installPath: '/abs/unlisted' }] },
    });
    await writeJson('.claude/settings.json', { enabledPlugins: {} });

    const roots = await discoverPluginSkillRoots(home);

    expect(roots.map((r) => r.base)).toEqual([path.join('/abs/unlisted', 'skills')]);
  });

  it('returns no roots when the manifest is missing', async () => {
    expect(await discoverPluginSkillRoots(home)).toEqual([]);
  });

  it('returns no roots when the manifest is malformed', async () => {
    const file = path.join(home, '.claude/plugins/installed_plugins.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{ not json', 'utf8');

    expect(await discoverPluginSkillRoots(home)).toEqual([]);
  });
});
