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

/** Read a single `.conduit/<NodeName>.md` — returns null if missing. */
export async function readConduitSummary(
  workspacePath: string,
  nodeName: string,
): Promise<string | null> {
  const file = path.join(workspacePath, CONDUIT_DIR, `${nodeName}.md`);
  return fs.readFile(file, 'utf8').catch(() => null);
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
  const copied: string[] = [];
  for (const src of sources) {
    const from = path.join(src.workspacePath, CONDUIT_DIR, `${src.nodeName}.md`);
    const to = path.join(targetDir, `${src.nodeName}.md`);
    try {
      await fs.copyFile(from, to);
      copied.push(src.nodeName);
    } catch {
      // Agent didn't write a summary — the placeholder path in runAgentNode
      // always writes one, so this should be rare. Missing file is ignored;
      // downstream agents just won't see that node's summary.
    }
  }
  return copied;
}

/**
 * Delete the workspace's `.conduit/` folder at run end. The folder is
 * gitignored — leaving it behind would leak prior-run state into any repo
 * the workspace points at. Best-effort; missing folder is a no-op.
 */
export async function clearConduitFolder(workspacePath: string): Promise<void> {
  await fs.rm(path.join(workspacePath, CONDUIT_DIR), { recursive: true, force: true });
}
