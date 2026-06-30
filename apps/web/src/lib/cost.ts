/**
 * Money/token formatting for run cost display. Shared so run rows, the run
 * detail header, and per-node summaries render spend identically. Null renders
 * as an em dash — older runs predate the cost rollup and have no value.
 */

/** Format a USD amount, e.g. `$0.0123` (sub-dollar) or `$1.20`. */
export function formatUsd(value: number | null | undefined): string {
  if (value == null) return '—';
  // Sub-dollar costs need more precision than the usual two places.
  const fractionDigits = value !== 0 && Math.abs(value) < 1 ? 4 : 2;
  return `$${value.toFixed(fractionDigits)}`;
}

/** Format a token count with thousands separators, e.g. `12,345`. */
export function formatTokens(value: number | null | undefined): string {
  if (value == null) return '—';
  return value.toLocaleString();
}
