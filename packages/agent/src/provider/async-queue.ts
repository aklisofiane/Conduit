/**
 * Minimal push-pull queue used to feed streaming-input SDKs a sequence of
 * user messages. The SDK reads the queue as an AsyncIterable while the
 * session pushes new turns onto it. Kept small — we don't need back-pressure
 * or multi-consumer semantics.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly queue: T[] = [];
  private readonly pending: Array<(v: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    const resolver = this.pending.shift();
    if (resolver) resolver({ value, done: false });
    else this.queue.push(value);
  }

  close(): void {
    this.closed = true;
    while (this.pending.length > 0) {
      this.pending.shift()!({ value: undefined as unknown as T, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.queue.length > 0) {
          return Promise.resolve({ value: this.queue.shift()!, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as unknown as T, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.pending.push(resolve);
        });
      },
    };
  }
}
