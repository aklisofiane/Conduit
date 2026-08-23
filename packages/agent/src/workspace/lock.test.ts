import { describe, expect, it } from 'vitest';
import { withPathLock } from './lock';

/** A promise with externally-callable resolve/reject. */
function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('withPathLock', () => {
  it('serializes two calls on the same key (FIFO, never overlapping)', async () => {
    const log: string[] = [];
    const gateA = deferred();

    const a = withPathLock('k', async () => {
      log.push('A-start');
      await gateA.promise;
      log.push('A-end');
    });
    const b = withPathLock('k', async () => {
      log.push('B-start');
      log.push('B-end');
    });

    // Let microtasks/macrotasks flush: A holds the lock, B must be blocked.
    await tick();
    expect(log).toEqual(['A-start']);

    gateA.resolve();
    await Promise.all([a, b]);

    expect(log).toEqual(['A-start', 'A-end', 'B-start', 'B-end']);
  });

  it('runs calls with different keys concurrently', async () => {
    let started = 0;
    const bothStarted = deferred();

    const makeFn = () => async () => {
      started += 1;
      if (started === 2) bothStarted.resolve();
      // If these were serialized, the second fn never starts and this hangs.
      await bothStarted.promise;
    };

    await Promise.all([withPathLock('key-a', makeFn()), withPathLock('key-b', makeFn())]);

    expect(started).toBe(2);
  });

  it('propagates the return value of fn back to the caller', async () => {
    const result = await withPathLock('ret', async () => 42);
    expect(result).toBe(42);
  });

  it('releases the lock when fn throws so a queued waiter proceeds', async () => {
    const log: string[] = [];
    const gate = deferred();

    const failing = withPathLock('boom', async () => {
      log.push('A-start');
      await gate.promise;
      log.push('A-throw');
      throw new Error('nope');
    });
    // Swallow here; assert rejection separately so the queued waiter still runs.
    const failingAssertion = expect(failing).rejects.toThrow('nope');

    const waiter = withPathLock('boom', async () => {
      log.push('B-start');
      return 'done';
    });

    await tick();
    expect(log).toEqual(['A-start']);

    gate.resolve();
    await failingAssertion;
    await expect(waiter).resolves.toBe('done');

    expect(log).toEqual(['A-start', 'A-throw', 'B-start']);
  });

  it('preserves submission order across three queued callers on one key', async () => {
    const order: number[] = [];
    const gate = deferred();

    const first = withPathLock('seq', async () => {
      await gate.promise;
      order.push(1);
    });
    const second = withPathLock('seq', async () => {
      order.push(2);
    });
    const third = withPathLock('seq', async () => {
      order.push(3);
    });

    gate.resolve();
    await Promise.all([first, second, third]);

    expect(order).toEqual([1, 2, 3]);
  });

  it('cleans up the map entry after the last holder releases (no leak)', async () => {
    // First, fully drain a key.
    await withPathLock('cleanup', async () => 'first');

    // A subsequent uncontended acquire on the same key must still run its fn.
    // (If the chain were left permanently gated, this would never resolve.)
    let ran = false;
    await withPathLock('cleanup', async () => {
      ran = true;
    });
    expect(ran).toBe(true);

    // And serialization still works for the same key afterwards, proving the
    // entry was re-established (not stuck) for the new contention round.
    const log: string[] = [];
    const gate = deferred();
    const a = withPathLock('cleanup', async () => {
      log.push('A-start');
      await gate.promise;
      log.push('A-end');
    });
    const b = withPathLock('cleanup', async () => {
      log.push('B-start');
    });

    await tick();
    expect(log).toEqual(['A-start']);
    gate.resolve();
    await Promise.all([a, b]);
    expect(log).toEqual(['A-start', 'A-end', 'B-start']);
  });
});
