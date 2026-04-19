import type { NodeRunRow } from '../../api/types.js';

/**
 * Shown on the "Error" tab. Pulls straight from `NodeRun.error`; the richer
 * stack / context stays in the timeline tab as a SYSTEM log entry.
 */
export function NodeError({ node }: { node: NodeRunRow }) {
  if (!node.error) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[12px] text-[var(--color-text-4)]">
        No error recorded for this node.
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <pre className="whitespace-pre-wrap rounded-md border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.06)] p-3 font-mono text-[12px] leading-relaxed text-[var(--color-error)]">
        {node.error}
      </pre>
    </div>
  );
}
