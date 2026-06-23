/**
 * Exact-match secret redaction for the observability event stream.
 *
 * Tool inputs/outputs ride the stream as observability and land in the
 * append-only `ExecutionLog` (replayed to every member of the run's org) and
 * the live UI. A tool can echo an injected credential back in its payload — an
 * MCP server returning request metadata, a `Bash` that prints env — so the
 * secret would persist in the audit log long after the credential is rotated.
 *
 * We can't pattern-match arbitrary secrets without false positives, but the
 * runner *knows the exact secret values it injected for this run*. So we redact
 * those by exact string match: reliable, no heuristics, and it leaves the rest
 * of the payload intact for debugging. This does not (and cannot) scrub
 * arbitrary PII — only the known injected credentials.
 */

export interface SecretEntry {
  /** Stable label surfaced in the placeholder, e.g. `ANTHROPIC_API_KEY`. */
  label: string;
  /** The literal secret value to redact wherever it appears. */
  value: string;
}

export interface SecretRedactor {
  /** Replace every known secret substring in a plain string. */
  redactString(input: string): string;
  /** Deep-redact known secrets inside a structured payload (strings + keys). */
  redactValue(value: unknown): unknown;
}

/**
 * Short values are skipped: real credentials are long and high-entropy, while
 * matching a short value (`"1"`, `"true"`, a region) would over-redact benign
 * content and defeat the point of keeping the payload readable.
 */
const MIN_SECRET_LENGTH = 8;

/**
 * Build a redactor over the run's injected secrets, or `undefined` when there's
 * nothing worth redacting (so callers can skip the work on the hot path).
 */
export function createSecretRedactor(secrets: SecretEntry[]): SecretRedactor | undefined {
  // Each secret contributes its raw value and its JSON-escaped inner form — an
  // oversized payload's preview is a slice of `JSON.stringify(...)`, where the
  // secret appears escaped. Longest term first so an overlapping shorter secret
  // can't pre-empt a longer match.
  const terms: Array<{ term: string; placeholder: string }> = [];
  for (const { label, value } of secrets) {
    if (!value || value.length < MIN_SECRET_LENGTH) continue;
    const placeholder = `[redacted:${label}]`;
    terms.push({ term: value, placeholder });
    const escaped = JSON.stringify(value).slice(1, -1);
    if (escaped !== value) terms.push({ term: escaped, placeholder });
  }
  if (terms.length === 0) return undefined;
  terms.sort((a, b) => b.term.length - a.term.length);

  // `split().join()` is a literal global replace — no regex escaping needed.
  const redactString = (input: string): string => {
    let out = input;
    for (const { term, placeholder } of terms) {
      if (out.includes(term)) out = out.split(term).join(placeholder);
    }
    return out;
  };

  const redactValue = (value: unknown): unknown => {
    if (typeof value === 'string') return redactString(value);
    if (Array.isArray(value)) {
      let changed = false;
      const next = value.map((item) => {
        const redacted = redactValue(item);
        if (redacted !== item) changed = true;
        return redacted;
      });
      return changed ? next : value;
    }
    if (value !== null && typeof value === 'object') {
      let changed = false;
      const next: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        const redactedKey = redactString(key);
        const redactedItem = redactValue(item);
        if (redactedKey !== key || redactedItem !== item) changed = true;
        next[redactedKey] = redactedItem;
      }
      return changed ? next : value;
    }
    return value;
  };

  return { redactString, redactValue };
}
