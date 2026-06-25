import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { RunnerEvent } from '@conduit/shared/runner';
import { errorMessage } from '@conduit/shared/runtime';
import { readRunnerEvents } from './json-line-iterator';

/**
 * Spawner-agnostic plumbing between a runner child process and the
 * orchestrator: liveness watchdog, stderr tailing, and the synthetic
 * `exit` event when the runner dies without reporting one. Consumed by
 * both `LocalDockerSpawner` and `LocalProcessSpawner` — nothing in here
 * knows whether the child is `docker run` or a bare `node` process.
 */

export const STDERR_TAIL_BYTES = 8 * 1024;

/**
 * Liveness-aware event pump. Watches the runner's stdout for either an
 * event or a heartbeat; if `livenessMs` elapses with neither, kills the
 * runner (via the spawner-supplied `cancel`) and surfaces a synthetic
 * `exit` error so the orchestrator's existing failure path picks it up.
 *
 * Liveness is measured at the raw-stdout level, not per yielded event: the
 * generator suspends at `yield` until the consumer pulls again, so a slow
 * consumer (e.g. a DB hiccup in the orchestrator's per-event handling)
 * must not look like a silent runner whose heartbeats sit buffered.
 *
 * Forwards the runner's stderr verbatim to the worker process's stderr —
 * useful for diagnosing environment-level failures (e.g. native build
 * errors, missing system tools) that the agent never gets to report.
 */
export async function* pumpEvents(
  child: ChildProcessWithoutNullStreams,
  livenessMs: number,
  cancel: () => Promise<void>,
  stderrTail: TailBuffer,
): AsyncIterable<RunnerEvent> {
  let lastTouch = Date.now();
  let livenessFired = false;
  child.stdout.on('data', () => {
    lastTouch = Date.now();
  });
  const liveness = setInterval(
    () => {
      if (Date.now() - lastTouch > livenessMs) {
        livenessFired = true;
        clearInterval(liveness);
        void cancel();
      }
    },
    Math.max(1_000, Math.floor(livenessMs / 4)),
  );

  const onMalformed = (line: string, err: unknown): void => {
    process.stderr.write(
      `[runner] malformed event line dropped: ${truncate(line, 200)} (${errorMessage(err)})\n`,
    );
  };

  child.stderr.on('data', (chunk: Buffer) => {
    stderrTail.push(chunk);
    process.stderr.write(chunk);
  });

  let sawTerminalExit = false;
  try {
    for await (const event of readRunnerEvents(child.stdout, onMalformed)) {
      if (event.kind === 'exit') sawTerminalExit = true;
      yield event;
    }
  } finally {
    clearInterval(liveness);
  }

  // Wait for the child process to actually exit so cancel() returns
  // when callers expect it to.
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve({ code: child.exitCode, signal: child.signalCode });
        return;
      }
      child.on('exit', (code, sig) => resolve({ code, signal: sig }));
    },
  );

  if (!sawTerminalExit) {
    yield {
      kind: 'exit',
      ok: false,
      error: {
        message: livenessFired
          ? `runner went silent for >${livenessMs}ms (no events or heartbeats); killed`
          : `runner exited (code=${exit.code ?? '?'}, signal=${exit.signal ?? '-'}) before emitting a terminal event${appendStderr(stderrTail.read())}`,
      },
    };
  }
}

function appendStderr(stderr: string): string {
  const trimmed = stderr.trim();
  if (!trimmed) return '';
  return ` — stderr: ${truncate(trimmed, 500)}`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** Bounded ring of the most recent bytes; read returns the tail as utf-8. */
export class TailBuffer {
  private chunks: Buffer[] = [];
  private size = 0;
  constructor(private readonly limit: number) {}
  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.limit && this.chunks.length > 0) {
      const head = this.chunks[0]!;
      const overflow = this.size - this.limit;
      if (head.length <= overflow) {
        this.chunks.shift();
        this.size -= head.length;
      } else {
        this.chunks[0] = head.subarray(overflow);
        this.size -= overflow;
      }
    }
  }
  read(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}
