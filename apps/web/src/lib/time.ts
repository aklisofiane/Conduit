/**
 * Relative-time formatting tuned to the mockup's voice: "2m ago", "4h ago",
 * "just now" for sub-minute, "6d ago" past a day. Lives in its own module
 * so both the workflow list and run pages share the same rendering.
 *
 * `now` is injectable so callers that already have a reference instant (and
 * tests) get a deterministic string instead of racing the wall clock.
 */
export function relativeFromNow(
  iso: string | Date | null | undefined,
  now: number = Date.now(),
): string {
  if (!iso) return '—';
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  const seconds = Math.floor((now - date.getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Mirror of {@link relativeFromNow} for instants in the future: "in 42m",
 * "in 6d", "in under a minute" below the minute mark. Used by the OAuth
 * credential staleness hint ("token expires in 42m").
 */
export function relativeUntil(
  iso: string | Date | null | undefined,
  now: number = Date.now(),
): string {
  if (!iso) return '—';
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  const seconds = Math.floor((date.getTime() - now) / 1000);
  if (seconds <= 0) return 'now';
  if (seconds < 60) return 'in under a minute';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.floor(hours / 24);
  return `in ${days}d`;
}

export function duration(start: string | Date | null | undefined, end?: string | Date | null): string {
  if (!start) return '—';
  const s = typeof start === 'string' ? new Date(start) : start;
  const e = end ? (typeof end === 'string' ? new Date(end) : end) : new Date();
  const total = Math.max(0, Math.floor((e.getTime() - s.getTime()) / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  if (m === 0) return `${sec}s`;
  return `${m}m ${sec.toString().padStart(2, '0')}s`;
}
