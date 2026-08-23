import { describe, expect, it } from 'vitest';
import { runnerEventSchema } from '@conduit/shared/runner';
import type { AgentEvent } from '@conduit/shared';
import {
  capAgentEvent,
  capPayload,
  MAX_EVENT_PAYLOAD_BYTES,
  type TruncatedPayload,
} from './payload-cap';
import { createSecretRedactor } from './secret-redactor';

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
    const event: AgentEvent = {
      type: 'tool_result',
      id: 't1',
      output: 'y'.repeat(MAX_EVENT_PAYLOAD_BYTES + 1),
    };
    const capped = capAgentEvent(event);
    if (capped.type !== 'tool_result') throw new Error('type changed');
    expect(capped.id).toBe('t1');
    expect(isTruncated(capped.output)).toBe(true);
  });

  it('caps a large tool_result.error alongside output', () => {
    const event: AgentEvent = {
      type: 'tool_result',
      id: 't1',
      output: 'y'.repeat(MAX_EVENT_PAYLOAD_BYTES + 1),
      error: 'e'.repeat(MAX_EVENT_PAYLOAD_BYTES + 1),
    };
    const capped = capAgentEvent(event);
    if (capped.type !== 'tool_result') throw new Error('type changed');
    expect(isTruncated(capped.output)).toBe(true);
    expect(capped.error).toBeDefined();
    // error stays a string (schema requires it) but is bounded well under the cap.
    expect(typeof capped.error).toBe('string');
    expect(Buffer.byteLength(capped.error!, 'utf8')).toBeLessThan(MAX_EVENT_PAYLOAD_BYTES);
    expect(capped.error).toContain('truncated');
  });

  it('leaves a small or absent tool_result.error untouched', () => {
    const small: AgentEvent = { type: 'tool_result', id: 't1', output: '', error: 'boom' };
    const cappedSmall = capAgentEvent(small);
    if (cappedSmall.type !== 'tool_result') throw new Error('type changed');
    expect(cappedSmall.error).toBe('boom');

    const none: AgentEvent = { type: 'tool_result', id: 't2', output: 'ok' };
    const cappedNone = capAgentEvent(none);
    if (cappedNone.type !== 'tool_result') throw new Error('type changed');
    expect(cappedNone.error).toBeUndefined();
  });

  it('caps oversized tool_call.input too', () => {
    const event: AgentEvent = {
      type: 'tool_call',
      id: 'c1',
      name: 'Bash',
      input: { script: 'z'.repeat(MAX_EVENT_PAYLOAD_BYTES + 1) },
    };
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
    const event: AgentEvent = {
      type: 'tool_result',
      id: 't1',
      output: 'q'.repeat(MAX_EVENT_PAYLOAD_BYTES + 1),
    };
    expect(() =>
      runnerEventSchema.parse({ kind: 'agent', event: capAgentEvent(event) }),
    ).not.toThrow();
  });
});

describe('payload cap — secret redaction', () => {
  const KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
  const redactor = createSecretRedactor([{ label: 'ANTHROPIC_API_KEY', value: KEY }]);

  it('redacts a known secret echoed in a small tool payload', () => {
    const capped = capPayload({ stdout: `export KEY=${KEY}` }, redactor) as Record<string, unknown>;
    expect(capped.stdout).toBe('export KEY=[redacted:ANTHROPIC_API_KEY]');
  });

  it('redacts a known secret in the preview of an oversized payload', () => {
    // Secret sits in the head, inside an otherwise huge body.
    const big = { token: KEY, body: 'x'.repeat(2 * 1024 * 1024) };
    const capped = capPayload(big, redactor);
    if (!isTruncated(capped)) throw new Error('expected truncation marker');
    expect(capped.preview).toContain('[redacted:ANTHROPIC_API_KEY]');
    expect(capped.preview).not.toContain(KEY);
  });

  it('redacts a known secret in tool_result.output and error', () => {
    const event: AgentEvent = {
      type: 'tool_result',
      id: 't1',
      output: { headers: { authorization: `Bearer ${KEY}` } },
      error: `failed with token ${KEY}`,
    };
    const capped = capAgentEvent(event, redactor);
    if (capped.type !== 'tool_result') throw new Error('type changed');
    expect(JSON.stringify(capped.output)).not.toContain(KEY);
    expect(JSON.stringify(capped.output)).toContain('[redacted:ANTHROPIC_API_KEY]');
    expect(capped.error).toBe('failed with token [redacted:ANTHROPIC_API_KEY]');
  });

  it('redacted output still validates against the wire schema', () => {
    const event: AgentEvent = { type: 'tool_result', id: 't1', output: { token: KEY } };
    expect(() =>
      runnerEventSchema.parse({ kind: 'agent', event: capAgentEvent(event, redactor) }),
    ).not.toThrow();
  });
});
