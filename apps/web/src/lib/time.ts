/**
 * Relative-time formatting tuned to the mockup's voice: "2m ago", "4h ago",
 * "just now" for sub-minute, "6d ago" past a day. Lives in its own module
 * so both the workflow list and run pages share the same rendering.
 */
export function relativeFromNow(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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
