import type { NodeRunRow } from '../../api/types.js';

/**
 * List of files the node touched in its workspace. Sourced from the
 * `NodeRun.output.files` snapshot the activity captured via `git status
 * --porcelain` right before teardown. Phase 3 ships the list only —
 * click-to-diff is deferred.
 */
export function ChangedFiles({ node }: { node: NodeRunRow }) {
  const files = node.output?.files ?? [];
  if (!files.length) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[12px] text-[var(--color-text-4)]">
        {node.status === 'COMPLETED' ? 'No files changed in this workspace.' : 'File list appears after the node completes.'}
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <ul className="space-y-1 font-mono text-[12px] text-[var(--color-text)]">
        {files.map((file) => (
          <li key={file} className="flex items-center gap-2">
            <span className="text-[var(--color-text-3)]">·</span>
            <span className="truncate">{file}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
