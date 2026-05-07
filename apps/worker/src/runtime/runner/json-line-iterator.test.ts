import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { RunnerEvent } from '@conduit/shared/runner';
import { readRunnerEvents } from './json-line-iterator';

describe('readRunnerEvents', () => {
  it('yields one event per JSON line', async () => {
    const stream = Readable.from(
      [
        '{"kind":"agent","event":{"type":"text","delta":"hi"}}\n',
        '{"kind":"heartbeat"}\n',
        '{"kind":"exit","ok":true,"changedFiles":[],"conduitSummary":null}\n',
      ].join(''),
    );
    const events: RunnerEvent[] = [];
    for await (const e of readRunnerEvents(stream, () => undefined)) events.push(e);
    expect(events.map((e) => e.kind)).toEqual(['agent', 'heartbeat', 'exit']);
  });

  it('drops malformed lines instead of throwing, and still emits valid ones', async () => {
    const stream = Readable.from(
      ['not json\n', '{"kind":"heartbeat"}\n', '{"kind":"bogus"}\n'].join(''),
    );
    const errors: string[] = [];
    const events: RunnerEvent[] = [];
    for await (const e of readRunnerEvents(stream, (line) => errors.push(line))) events.push(e);
    expect(events.map((e) => e.kind)).toEqual(['heartbeat']);
    expect(errors).toHaveLength(2);
  });

  it('handles split chunks across newlines', async () => {
    async function* chunks(): AsyncIterable<string> {
      yield '{"kind":"agent",';
      yield '"event":{"type":"done"}}\n{"kind":"heartbeat"}\n';
    }
    const stream = Readable.from(chunks());
    const events: RunnerEvent[] = [];
    for await (const e of readRunnerEvents(stream, () => undefined)) events.push(e);
    expect(events.map((e) => e.kind)).toEqual(['agent', 'heartbeat']);
  });
});
