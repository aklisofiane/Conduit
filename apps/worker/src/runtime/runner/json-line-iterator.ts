import { runnerEventSchema, type RunnerEvent } from '@conduit/shared/runner';

/**
 * Wrap a `Readable` of UTF-8 stdout into an async iterable of validated
 * `RunnerEvent`s. Splits on `\n`, parses each line, and validates against
 * the protocol schema. Logs malformed lines and skips them rather than
 * tearing down the stream — agents emitting incidental stdout (a stray
 * `console.log` from inside a tool call) shouldn't crash the run.
 *
 * The returned iterator ends when the underlying stream emits `end` or
 * `error`. The caller decides what a missing terminal `exit` means.
 *
 * A single buffered line is capped at `MAX_LINE_BYTES` — a runaway producer
 * that never sends `\n` would otherwise grow `buffer` without bound and
 * stall the event loop in `JSON.parse`.
 */
const MAX_LINE_BYTES = 8 * 1024 * 1024;

export async function* readRunnerEvents(
  stream: NodeJS.ReadableStream,
  onMalformed: (line: string, err: unknown) => void,
): AsyncIterable<RunnerEvent> {
  // Hold incoming chunks as an array and only join when scanning for `\n`,
  // so a long unbroken line doesn't quadratic-cost via `+=`.
  let pending: string[] = [];
  let pendingSize = 0;
  let dropping = false;
  const events: RunnerEvent[] = [];
  let resolveNext: ((value: void) => void) | null = null;
  let done = false;
  let streamError: unknown = null;

  const wake = (): void => {
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r();
    }
  };

  const flushLine = (line: string): void => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    try {
      events.push(runnerEventSchema.parse(JSON.parse(trimmed)));
    } catch (err) {
      onMalformed(trimmed, err);
    }
  };

  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    pending.push(chunk);
    pendingSize += chunk.length;
    if (pending.length === 1 && chunk.indexOf('\n') < 0) {
      // Fast path: nothing to split yet.
    } else {
      const joined = pending.join('');
      let start = 0;
      let nl = joined.indexOf('\n', start);
      while (nl >= 0) {
        flushLine(joined.slice(start, nl));
        start = nl + 1;
        nl = joined.indexOf('\n', start);
        dropping = false;
      }
      const tail = start === 0 ? joined : joined.slice(start);
      pending = tail.length > 0 ? [tail] : [];
      pendingSize = tail.length;
    }
    if (pendingSize > MAX_LINE_BYTES) {
      if (!dropping) {
        onMalformed(
          '',
          new Error(`line exceeded ${MAX_LINE_BYTES} bytes; dropping until next newline`),
        );
        dropping = true;
      }
      pending = [];
      pendingSize = 0;
    }
    wake();
  });
  stream.on('end', () => {
    if (pendingSize > 0) flushLine(pending.join(''));
    pending = [];
    pendingSize = 0;
    done = true;
    wake();
  });
  stream.on('error', (err: unknown) => {
    streamError = err;
    done = true;
    wake();
  });

  while (true) {
    while (events.length > 0) {
      const e = events.shift()!;
      yield e;
    }
    if (done) {
      if (streamError) throw streamError;
      return;
    }
    await new Promise<void>((resolve) => {
      resolveNext = resolve;
    });
  }
}
