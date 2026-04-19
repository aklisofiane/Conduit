import type { NodeRunRow } from '../../api/types.js';

/**
 * Render `.conduit/<NodeName>.md` for a node, captured at the end of the
 * run (before workspace cleanup). Freeform markdown — we don't render it,
 * we show the raw text in monospace so agent-written contents are never
 * misinterpreted. A markdown pass can come later if users ask.
 */
export function NodeSummary({ node }: { node: NodeRunRow }) {
  const summary = node.conduitSummary;
  if (!summary) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[12px] text-[var(--color-text-4)]">
        {node.status === 'COMPLETED'
          ? 'Agent did not write a summary.'
          : 'Summary appears after the node completes.'}
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-[var(--color-text)]">
        {summary}
      </pre>
    </div>
  );
}
