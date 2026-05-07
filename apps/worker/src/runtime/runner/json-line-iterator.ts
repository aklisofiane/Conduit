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
 */
export async function* readRunnerEvents(
  stream: NodeJS.ReadableStream,
  onMalformed: (line: string, err: unknown) => void,
): AsyncIterable<RunnerEvent> {
  let buffer = '';
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

  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    buffer += chunk;
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.length > 0) {
        try {
          events.push(runnerEventSchema.parse(JSON.parse(line)));
        } catch (err) {
          onMalformed(line, err);
        }
      }
      nl = buffer.indexOf('\n');
    }
    wake();
  });
  stream.on('end', () => {
    if (buffer.trim().length > 0) {
      try {
        events.push(runnerEventSchema.parse(JSON.parse(buffer.trim())));
      } catch (err) {
        onMalformed(buffer, err);
      }
      buffer = '';
    }
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
