import { describe, expect, it } from 'vitest';
import { runnerEventSchema } from '@conduit/shared/runner';
import type { AgentEvent } from '@conduit/shared';
import { capAgentEvent, capPayload, MAX_EVENT_PAYLOAD_BYTES, type TruncatedPayload } from './payload-cap';

const isTruncated = (v: unknown): v is TruncatedPayload =>
  typeof v === 'object' && v !== null && (v as Record<string, unknown>).__conduitTruncated === true;

describe('payload cap', () => {
  it('passes small payloads through untouched (same reference)', () => {
    const small = { status: 'completed', conclusion: 'success' };
    expect(capPayload(small)).toBe(small);
  });

  it('replaces an oversized payload with a bounded marker', () => {
    const big = { body: 'x'.repeat(2 * 1024 * 1024) }; // ~2 MB hydrated body
    const capped = capPayload(big);
    if (!isTruncated(capped)) throw new Error('expected truncation marker');
    expect(capped.bytes).toBeGreaterThan(2 * 1024 * 1024);
    // The marker itself must be small — that is the entire point.
    expect(Buffer.byteLength(JSON.stringify(capped), 'utf8')).toBeLessThan(MAX_EVENT_PAYLOAD_BYTES);
    expect(capped.preview).toContain('…');
  });

  it('caps tool_result.output but leaves the envelope intact', () => {
    const event: AgentEvent = { type: 'tool_result', id: 't1', output: 'y'.repeat(MAX_EVENT_PAYLOAD_BYTES + 1) };
    const capped = capAgentEvent(event);
    if (capped.type !== 'tool_result') throw new Error('type changed');
    expect(capped.id).toBe('t1');
    expect(isTruncated(capped.output)).toBe(true);
  });

  it('caps oversized tool_call.input too', () => {
    const event: AgentEvent = { type: 'tool_call', id: 'c1', name: 'Bash', input: { script: 'z'.repeat(MAX_EVENT_PAYLOAD_BYTES + 1) } };
    const capped = capAgentEvent(event);
    if (capped.type !== 'tool_call') throw new Error('type changed');
    expect(isTruncated(capped.input)).toBe(true);
  });

  it('leaves non-tool events alone', () => {
    const text: AgentEvent = { type: 'text', delta: 'hi' };
    const usage: AgentEvent = { type: 'usage', inputTokens: 1, outputTokens: 2 };
    expect(capAgentEvent(text)).toBe(text);
    expect(capAgentEvent(usage)).toBe(usage);
  });

  it('a capped event still validates against the wire schema', () => {
    const event: AgentEvent = { type: 'tool_result', id: 't1', output: 'q'.repeat(MAX_EVENT_PAYLOAD_BYTES + 1) };
    expect(() => runnerEventSchema.parse({ kind: 'agent', event: capAgentEvent(event) })).not.toThrow();
  });
});
