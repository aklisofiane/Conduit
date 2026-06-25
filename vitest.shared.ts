import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Shared base config for every Vitest project in the workspace. Each project
 * extends this with its own `test.include` glob, timeouts, and setup files.
 *
 * The aliases let tests import `@conduit/*` straight from package sources —
 * no build step needed between a code change and `npm test`.
 */
export const sharedVitestConfig = defineConfig({
  resolve: {
    alias: {
      // Subpath aliases must precede the bare-module alias — otherwise
      // `@conduit/shared/runner` matches the bare prefix and resolves
      // to `packages/shared/src/index.ts/runner` (i.e., nothing).
      '@conduit/shared/runner': path.resolve(__dirname, 'packages/shared/src/runner/index.ts'),
      '@conduit/shared/platform': path.resolve(__dirname, 'packages/shared/src/platform/index.ts'),
      '@conduit/shared/crypto': path.resolve(__dirname, 'packages/shared/src/crypto/index.ts'),
      '@conduit/shared/runtime': path.resolve(__dirname, 'packages/shared/src/runtime/index.ts'),
      '@conduit/shared/webhook': path.resolve(__dirname, 'packages/shared/src/webhook/index.ts'),
      '@conduit/shared/workflow': path.resolve(__dirname, 'packages/shared/src/workflow/index.ts'),
      '@conduit/shared/label': path.resolve(__dirname, 'packages/shared/src/label/index.ts'),
      '@conduit/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
      '@conduit/agent': path.resolve(__dirname, 'packages/agent/src/index.ts'),
      '@conduit/database': path.resolve(__dirname, 'packages/database/src/index.ts'),
    },
  },
});

/** Shared Vitest `test.exclude` — spread into each project's `test` block. */
export const SHARED_TEST_EXCLUDE = ['**/node_modules/**', '**/dist/**'];
