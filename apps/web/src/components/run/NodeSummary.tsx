import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { NodeRunRow } from '../../api/types.js';

/**
 * Render `.conduit/<NodeName>.md` for a node, captured at the end of the
 * run. Agents write freeform markdown — we render it with `react-markdown`
 * (no raw HTML, so agent text can't inject markup) and style the elements
 * to match the rest of the run view.
 */
export function NodeSummary({ node }: { node: NodeRunRow }) {
  const summary = node.conduitSummary;
  if (!summary) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-small text-[var(--color-text-muted)]">
        {node.status === 'COMPLETED'
          ? 'Agent did not write a summary.'
          : 'Summary appears after the node completes.'}
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <article className="markdown text-base leading-relaxed text-[var(--color-text)]">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
      </article>
    </div>
  );
}
