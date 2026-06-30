import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { NodeRunRow } from '../../api/types.js';
import { formatTokens, formatUsd, totalInputTokens } from '../../lib/cost.js';

/**
 * Render `.conduit/<NodeName>.md` for a node, captured at the end of the
 * run. Agents write freeform markdown — we render it with `react-markdown`
 * (no raw HTML, so agent text can't inject markup) and style the elements
 * to match the rest of the run view. A stats strip above the summary surfaces
 * the node's token usage and snapshot-at-write cost when present.
 */
export function NodeSummary({ node }: { node: NodeRunRow }) {
  const summary = node.conduitSummary;
  const usage = node.usage;
  const inputTotal = totalInputTokens(usage);
  const cached = usage?.cachedInputTokens ?? 0;
  const hasStats = inputTotal != null || usage?.outputTokens != null || node.costUsd != null;

  if (!summary && !hasStats) {
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
      {hasStats && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-small text-[var(--color-text-muted)]">
          <span>
            tokens: {formatTokens(inputTotal)} in · {formatTokens(usage?.outputTokens ?? null)} out
            {cached > 0 && (
              <span className="text-[var(--color-text-muted)]">
                {' '}
                ({formatTokens(cached)} cached)
              </span>
            )}
          </span>
          {node.costUsd != null && (
            <span>
              cost: <span className="text-[var(--color-text)]">{formatUsd(node.costUsd)}</span>
              {node.priceSnapshot?.source === 'override' && (
                <span className="text-[var(--color-text-muted)]"> · override price</span>
              )}
            </span>
          )}
        </div>
      )}
      {summary ? (
        <article className="markdown text-base leading-relaxed text-[var(--color-text)]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
        </article>
      ) : (
        <div className="font-mono text-small text-[var(--color-text-muted)]">
          {node.status === 'COMPLETED'
            ? 'Agent did not write a summary.'
            : 'Summary appears after the node completes.'}
        </div>
      )}
    </div>
  );
}
