import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * GitHub signs webhook bodies with HMAC-SHA256 and sends the digest in the
 * `X-Hub-Signature-256` header as `sha256=<hex>`. We re-compute over the
 * *raw* request body (post-JSON-parse is too late) and compare with a
 * constant-time check so the signature can't be teased out byte-by-byte.
 *
 * Returns `false` on any malformed input rather than throwing — callers
 * translate that into a 401, never a 5xx.
 */
export function verifyGithubSignature(
  secret: string,
  rawBody: Buffer | string,
  header: string | undefined,
): boolean {
  if (!secret || !header) return false;
  const lower = header.toLowerCase();
  const expected = lower.startsWith('sha256=') ? lower.slice('sha256='.length) : lower;
  if (!/^[0-9a-f]+$/.test(expected)) return false;

  const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  const computed = createHmac('sha256', secret).update(body).digest('hex');
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Timestamp replay-protection. Returns `true` when the event is within
 * `maxAgeMs` of `now`. Platforms that don't expose a timestamp header
 * should skip this check (pass `undefined` — returns `true`).
 */
export function isFreshEvent(
  timestampMs: number | undefined,
  now: number = Date.now(),
  maxAgeMs = 5 * 60_000,
): boolean {
  if (timestampMs === undefined) return true;
  if (!Number.isFinite(timestampMs)) return false;
  return Math.abs(now - timestampMs) <= maxAgeMs;
}
