import fs from 'node:fs/promises';
import path from 'node:path';

const CONDUIT_DIR = '.conduit';

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
 * Delete the workspace's `.conduit/` folder at run end. The folder is
 * gitignored — leaving it behind would leak prior-run state into any repo
 * the workspace points at. Best-effort; missing folder is a no-op.
 */
export async function clearConduitFolder(workspacePath: string): Promise<void> {
  await fs.rm(path.join(workspacePath, CONDUIT_DIR), { recursive: true, force: true });
}
