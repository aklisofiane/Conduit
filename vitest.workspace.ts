import { defineWorkspace } from 'vitest/config';
import { sharedVitestConfig } from './vitest.shared';

/**
 * Four projects, each with its own include glob, timeouts, and (later) setup
 * files. See docs/VALIDATION.md for what each layer is responsible for.
 *
 *   unit        — fast, no I/O, pure logic.
 *   integration — real Postgres/Temporal/Redis via docker-compose.test.yml.
 *   api         — Nest app booted in-process, supertest HTTP requests.
 *   e2e         — full stack (api + worker child processes, StubProvider).
 */
export default defineWorkspace([
  {
    ...sharedVitestConfig,
    test: {
      name: 'unit',
      include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts'],
      exclude: ['**/node_modules/**', '**/dist/**'],
      testTimeout: 5_000,
    },
  },
  {
    ...sharedVitestConfig,
    test: {
      name: 'integration',
      include: ['packages/**/test/integration/**/*.test.ts', 'apps/**/test/integration/**/*.test.ts'],
      exclude: ['**/node_modules/**', '**/dist/**'],
      testTimeout: 60_000,
      hookTimeout: 60_000,
    },
  },
  {
    ...sharedVitestConfig,
    test: {
      name: 'api',
      include: ['apps/api/test/contract/**/*.test.ts'],
      exclude: ['**/node_modules/**', '**/dist/**'],
      testTimeout: 30_000,
      hookTimeout: 60_000,
    },
  },
  {
    ...sharedVitestConfig,
    test: {
      name: 'e2e',
      include: ['test/e2e/**/*.test.ts'],
      exclude: ['**/node_modules/**', '**/dist/**'],
      testTimeout: 120_000,
      hookTimeout: 180_000,
      globalSetup: ['test/e2e/global-setup.ts'],
    },
  },
]);
