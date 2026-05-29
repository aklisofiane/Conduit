import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveFragments, loadAgentPresets } from './agent-preset-loader';

const FRAGMENT_CONTENT = '## Marker contract\n\nCanonical marker text here.';

const VALID_FRONTMATTER = [
  '---',
  'id: test-preset',
  'name: Test Preset',
  'description: A test preset',
  'category: publish',
  'provider: claude',
  'model: claude-sonnet-4-6',
  '---',
].join('\n');

describe('resolveFragments', () => {
  let tmpDir: string;
  let warnSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'preset-frag-'));
    await fs.mkdir(path.join(tmpDir, 'fragments'), { recursive: true });
    warnSpy = vi.fn();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(warnSpy);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('resolves a single {{include:}} directive with the fragment content', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'fragments', 'marker-contract.md'),
      FRAGMENT_CONTENT,
    );

    const content = 'Some preamble.\n\n{{include:marker-contract}}\n\nSome epilogue.';
    const result = await resolveFragments(content, tmpDir, new Logger());

    expect(result).toBe(
      `Some preamble.\n\n${FRAGMENT_CONTENT}\n\nSome epilogue.`,
    );
    expect(result).not.toContain('{{include:');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('resolves multiple different directives in one content string', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'fragments', 'header.md'),
      '# Header Fragment',
    );
    await fs.writeFile(
      path.join(tmpDir, 'fragments', 'footer.md'),
      '---\nFooter text.',
    );

    const content = '{{include:header}}\n\nBody text.\n\n{{include:footer}}';
    const result = await resolveFragments(content, tmpDir, new Logger());

    expect(result).toBe('# Header Fragment\n\nBody text.\n\n---\nFooter text.');
    expect(result).not.toContain('{{include:');
  });

  it('returns null and warns when a referenced fragment file is missing', async () => {
    const content = 'Before.\n\n{{include:nonexistent}}\n\nAfter.';
    const result = await resolveFragments(content, tmpDir, new Logger());

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects a directive with an invalid fragment name (path traversal)', async () => {
    const content = '{{include:../../../etc/passwd}}';
    const result = await resolveFragments(content, tmpDir, new Logger());

    expect(result).toBeNull();
  });

  it('passes content through unchanged when no directives are present', async () => {
    const content = 'Plain instructions with no includes.';
    const result = await resolveFragments(content, tmpDir, new Logger());

    expect(result).toBe(content);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('reads fragment as raw text without parsing frontmatter', async () => {
    const fragmentWithFrontmatter = '---\ntitle: Should Stay\n---\n\nBody.';
    await fs.writeFile(
      path.join(tmpDir, 'fragments', 'raw-frag.md'),
      fragmentWithFrontmatter,
    );

    const content = '{{include:raw-frag}}';
    const result = await resolveFragments(content, tmpDir, new Logger());

    expect(result).toContain('---\ntitle: Should Stay\n---');
    expect(result).toContain('Body.');
  });
});

describe('loadAgentPresets with fragments', () => {
  let tmpDir: string;
  let warnSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'preset-load-'));
    await fs.mkdir(path.join(tmpDir, 'fragments'), { recursive: true });
    warnSpy = vi.fn();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(warnSpy);
    vi.stubEnv('CONDUIT_AGENT_PRESETS_DIR', tmpDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('loads a preset that uses {{include:}} with the fragment content injected', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'fragments', 'marker-contract.md'),
      FRAGMENT_CONTENT,
    );
    await fs.writeFile(
      path.join(tmpDir, 'test-preset.md'),
      `${VALID_FRONTMATTER}\n\nPreamble.\n\n{{include:marker-contract}}\n\nEpilogue.`,
    );

    const presets = await loadAgentPresets(new Logger());

    expect(presets).toHaveLength(1);
    expect(presets[0]!.id).toBe('test-preset');
    expect(presets[0]!.instructions).toContain(FRAGMENT_CONTENT);
    expect(presets[0]!.instructions).not.toContain('{{include:');
  });

  it('skips a preset whose fragment is missing', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'broken.md'),
      `${VALID_FRONTMATTER}\n\n{{include:does-not-exist}}`,
    );

    const presets = await loadAgentPresets(new Logger());

    expect(presets).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('excludes a preset with an invalid fragment name (path traversal)', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'evil.md'),
      `${VALID_FRONTMATTER}\n\n{{include:../../../etc/passwd}}`,
    );

    const presets = await loadAgentPresets(new Logger());

    expect(presets).toHaveLength(0);
  });

  it('loads presets without directives identically to before', async () => {
    const instructions = 'Plain instructions without any includes.';
    await fs.writeFile(
      path.join(tmpDir, 'plain.md'),
      `${VALID_FRONTMATTER}\n\n${instructions}`,
    );

    const presets = await loadAgentPresets(new Logger());

    expect(presets).toHaveLength(1);
    expect(presets[0]!.instructions).toBe(instructions);
  });
});
