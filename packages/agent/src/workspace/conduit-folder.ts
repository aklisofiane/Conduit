import fs from 'node:fs/promises';
import path from 'node:path';

export const CONDUIT_DIR = '.conduit';

/**
 * Read every `.conduit/*.md` summary from `workspacePath` as `{ NodeName, body }`.
 * Used by downstream agents' context-building and by the UI's run detail view.
 */
export async function readConduitSummaries(
  workspacePath: string,
): Promise<Array<{ nodeName: string; body: string }>> {
  const dir = path.join(workspacePath, CONDUIT_DIR);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: Array<{ nodeName: string; body: string }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const body = await fs.readFile(path.join(dir, entry.name), 'utf8');
    out.push({ nodeName: entry.name.slice(0, -3), body });
  }
  return out;
}

/**
 * Read a single `.conduit/<NodeName>.md` — returns null only when the file is
 * absent (`ENOENT`). Any other read failure (permissions, a corrupted path,
 * unexpected I/O) is rethrown so callers can't mistake a real error for a
 * legitimately-missing summary and silently drop required handoff context.
 */
export async function readConduitSummary(
  workspacePath: string,
  nodeName: string,
): Promise<string | null> {
  const file = path.join(workspacePath, CONDUIT_DIR, `${nodeName}.md`);
  try {
    return await fs.readFile(file, 'utf8');
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/**
 * Copy `.conduit/<nodeName>.md` from each source workspace into the target's
 * `.conduit/` directory. Used after a parallel group merges back so the
 * downstream node sees every sibling's summary in the merged workspace.
 * `.conduit/` is gitignored — the git merge doesn't carry it, so this is
 * a straight file copy.
 */
export async function copyConduitSummaries(
  sources: Array<{ nodeName: string; workspacePath: string }>,
  targetWorkspacePath: string,
): Promise<string[]> {
  const targetDir = path.join(targetWorkspacePath, CONDUIT_DIR);
  await fs.mkdir(targetDir, { recursive: true });
  const results = await Promise.all(
    sources.map(async (src) => {
      const from = path.join(src.workspacePath, CONDUIT_DIR, `${src.nodeName}.md`);
      const to = path.join(targetDir, `${src.nodeName}.md`);
      try {
        await fs.copyFile(from, to);
        return src.nodeName;
      } catch {
        return null;
      }
    }),
  );
  return results.filter((n): n is string => n !== null);
}

/**
 * Delete the workspace's `.conduit/` folder at run end. The folder is
 * gitignored — leaving it behind would leak prior-run state into any repo
 * the workspace points at. Best-effort; missing folder is a no-op.
 */
export async function clearConduitFolder(workspacePath: string): Promise<void> {
  await fs.rm(path.join(workspacePath, CONDUIT_DIR), { recursive: true, force: true });
}

/**
 * Copy the upstream's `.conduit/` folder into a freshly-created branched
 * worktree. `git worktree add` only checks out tracked files and `.conduit/`
 * is gitignored, so without this step parallel siblings can't see the
 * upstream's handoff summary. Best-effort; no upstream `.conduit/` is a no-op.
 */
export async function cloneConduitFolder(
  sourceWorkspacePath: string,
  targetWorkspacePath: string,
): Promise<void> {
  const src = path.join(sourceWorkspacePath, CONDUIT_DIR);
  const dst = path.join(targetWorkspacePath, CONDUIT_DIR);
  try {
    await fs.cp(src, dst, { recursive: true, errorOnExist: false, force: true });
  } catch (err) {
    if (isNotFound(err)) return;
    throw err;
  }
}

export function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'ENOENT'
  );
}
