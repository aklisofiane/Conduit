import type { AgentEvent } from '@conduit/shared';

/**
 * Tool inputs/outputs ride the event stream as observability only — the agent
 * already consumed the real result in-process — so capping the copy here is
 * lossless for agent behaviour. It keeps multi-MB payloads (e.g. a hydrated
 * GitHub response body) off the orchestrator's synchronous JSON.parse + Prisma
 * write + Redis publish path, where a burst of them can starve the Temporal
 * heartbeat and fail an otherwise-healthy run. Keep head+tail so the live UI
 * and ExecutionLog still show what the tool did.
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
 * single large body can't stall the orchestrator's per-event handling. Only
 * `tool_call.input` / `tool_result.output` are unbounded (`z.unknown()`); every
 * other event kind carries small, bounded fields and passes through untouched.
 */
export function capAgentEvent(event: AgentEvent): AgentEvent {
  if (event.type === 'tool_call') return { ...event, input: capPayload(event.input) };
  if (event.type === 'tool_result') return { ...event, output: capPayload(event.output) };
  return event;
}

export function capPayload(value: unknown): unknown {
  const json = JSON.stringify(value);
  if (json === undefined) return value; // undefined / symbol / function — nothing to serialize
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes <= MAX_EVENT_PAYLOAD_BYTES) return value;
  return {
    __conduitTruncated: true,
    bytes,
    preview: `${json.slice(0, PREVIEW_HEAD_BYTES)}\n…\n${json.slice(-PREVIEW_TAIL_BYTES)}`,
  } satisfies TruncatedPayload;
}
