import { errorMessage } from '@conduit/shared/runtime';

export interface LazySdkLoader<T> {
  /** Memoized load — dynamic-imports the SDK on first call (or the test loader). */
  load(): Promise<T>;
  /** Test seam: inject a fake module and reset the cache. */
  setLoaderForTests(loader: (() => Promise<T>) | undefined): void;
}

/**
 * Lazily import an optional provider SDK so this package stays usable in
 * environments where it isn't installed (tests that only use `StubProvider`,
 * schema tools, type-only consumers). The import is deferred to first use and
 * memoized; a missing module turns into an actionable error.
 *
 * Each provider owns one instance — the module-level cache means the dynamic
 * import runs at most once per process, and the `setLoaderForTests` seam lets
 * unit tests stub the SDK without installing the real one.
 */
export function makeLazySdkLoader<T>(
  moduleName: string,
  importer: () => Promise<unknown>,
): LazySdkLoader<T> {
  let cached: T | undefined;
  let injected: (() => Promise<T>) | undefined;
  return {
    async load(): Promise<T> {
      if (cached) return cached;
      if (injected) {
        cached = await injected();
        return cached;
      }
      cached = (await importer().catch((err: unknown) => {
        throw new Error(
          `${moduleName} is not installed. Install it in the worker app. Original: ${errorMessage(err)}`,
        );
      })) as T;
      return cached;
    },
    setLoaderForTests(loader) {
      injected = loader;
      cached = undefined;
    },
  };
}
