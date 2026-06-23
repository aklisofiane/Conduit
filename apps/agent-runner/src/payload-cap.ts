import type { AgentEvent } from '@conduit/shared';
import type { SecretRedactor } from './secret-redactor';

/**
 * Tool inputs/outputs ride the event stream as observability only — the agent
 * already consumed the real result in-process — so capping the copy here is
 * lossless for agent behaviour. It keeps multi-MB payloads (e.g. a hydrated
 * GitHub response body) off the orchestrator's synchronous JSON.parse + Prisma
 * write + Redis publish path, where a burst of them can starve the Temporal
 * heartbeat and fail an otherwise-healthy run. Keep head+tail so the live UI
 * and ExecutionLog still show what the tool did.
 *
 * A tool can also echo an injected credential back in its payload, which would
 * then persist in `ExecutionLog` and stream to the UI. When a {@link
 * SecretRedactor} is supplied we exact-match-redact the run's known secrets
 * from every payload (full small ones and the preview of oversized ones)
 * before they leave the runner. See {@link SecretRedactor}.
 */
export const MAX_EVENT_PAYLOAD_BYTES = 64 * 1024;
const PREVIEW_HEAD_BYTES = 4 * 1024;
const PREVIEW_TAIL_BYTES = 1 * 1024;

/** Marker that replaces an oversized payload; `output`/`input` are `z.unknown()`, so it validates. */
export interface TruncatedPayload {
  __conduitTruncated: true;
  bytes: number;
  preview: string;
}

/**
 * Replace oversized tool payloads with a bounded, self-describing marker so a
 * single large body can't stall the orchestrator's per-event handling, and
 * redact known injected secrets from what's left. `tool_call.input` /
 * `tool_result.output` are unbounded (`z.unknown()`), and `tool_result.error`
 * is an unbounded string a failing provider can fill with the same multi-MB
 * body it puts in `output` (the Claude provider mirrors the tool `content` into
 * both on `is_error`). Every other event kind carries small, bounded fields and
 * passes through untouched (no secrets ride those).
 */
export function capAgentEvent(event: AgentEvent, redactor?: SecretRedactor): AgentEvent {
  if (event.type === 'tool_call') return { ...event, input: capPayload(event.input, redactor) };
  if (event.type === 'tool_result') {
    return {
      ...event,
      output: capPayload(event.output, redactor),
      error: capErrorString(event.error, redactor),
    };
  }
  return event;
}

export function capPayload(value: unknown, redactor?: SecretRedactor): unknown {
  const json = JSON.stringify(value);
  if (json === undefined) return value; // undefined / symbol / function — nothing to serialize
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes <= MAX_EVENT_PAYLOAD_BYTES) return redactor ? redactor.redactValue(value) : value;
  const preview = `${json.slice(0, PREVIEW_HEAD_BYTES)}\n…\n${json.slice(-PREVIEW_TAIL_BYTES)}`;
  return {
    __conduitTruncated: true,
    bytes,
    preview: redactor ? redactor.redactString(preview) : preview,
  } satisfies TruncatedPayload;
}

/**
 * Cap `tool_result.error`. The schema types it as a plain string, so we can't
 * swap in the {@link TruncatedPayload} marker — we keep it a string and inline a
 * head+tail preview with a byte count, matching the marker's intent.
 */
export function capErrorString(
  error: string | undefined,
  redactor?: SecretRedactor,
): string | undefined {
  if (error === undefined) return error;
  const bytes = Buffer.byteLength(error, 'utf8');
  const capped =
    bytes <= MAX_EVENT_PAYLOAD_BYTES
      ? error
      : `${error.slice(0, PREVIEW_HEAD_BYTES)}\n…[truncated ${bytes} bytes]…\n${error.slice(-PREVIEW_TAIL_BYTES)}`;
  return redactor ? redactor.redactString(capped) : capped;
}
