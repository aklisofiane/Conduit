import { describe, expect, it } from 'vitest';
import { AsyncQueue } from './async-queue';

describe('AsyncQueue', () => {
  it('buffers values pushed before iteration and yields them FIFO', async () => {
    const q = new AsyncQueue<string>();
    q.push('a');
    q.push('b');
    q.push('c');
    q.close();

    const out: string[] = [];
    for await (const v of q) out.push(v);

    expect(out).toEqual(['a', 'b', 'c']);
  });

  it('resolves a next() awaited while empty as soon as a later push() arrives', async () => {
    const q = new AsyncQueue<string>();
    const iterator = q[Symbol.asyncIterator]();

    // No buffered value and not closed -> this is the pending-resolver path.
    const pending = iterator.next();
    q.push('hello');

    const result = await pending;
    expect(result).toEqual({ value: 'hello', done: false });
  });

  it('resolves all currently-pending next() promises with done:true on close()', async () => {
    const q = new AsyncQueue<string>();
    const iterator = q[Symbol.asyncIterator]();

    const p1 = iterator.next();
    const p2 = iterator.next();
    q.close();

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ value: undefined, done: true });
    expect(r2).toEqual({ value: undefined, done: true });
  });

  it('treats push() after close() as a no-op and still terminates the iterator', async () => {
    const q = new AsyncQueue<string>();
    q.close();
    q.push('dropped');

    const out: string[] = [];
    for await (const v of q) out.push(v);

    expect(out).toEqual([]);
  });

  it('drains buffered values pushed before close() before reporting done', async () => {
    const q = new AsyncQueue<string>();
    q.push('x');
    q.push('y');
    q.close();

    const iterator = q[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ value: 'x', done: false });
    expect(await iterator.next()).toEqual({ value: 'y', done: false });
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });

  it('preserves arrival order across interleaved push/next', async () => {
    const q = new AsyncQueue<string>();
    const iterator = q[Symbol.asyncIterator]();

    // push A, then next() -> A (buffered path)
    q.push('A');
    expect(await iterator.next()).toEqual({ value: 'A', done: false });

    // next() pending, then push B -> resolves with B (pending-resolver path)
    const pendingB = iterator.next();
    q.push('B');
    expect(await pendingB).toEqual({ value: 'B', done: false });
  });
});
