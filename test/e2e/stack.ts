import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { DEFAULT_TEMPORAL_TASK_QUEUE } from '@conduit/shared';

/**
 * Test-stack env. Ports match docker-compose.test.yml. Call sites read from
 * here so a port change only needs updating in one place.
 */
export const TEST_STACK_ENV = {
  DATABASE_URL: 'postgresql://conduit:conduit@localhost:55432/conduit_test?schema=public',
  TEMPORAL_ADDRESS: 'localhost:57233',
  TEMPORAL_NAMESPACE: 'default',
  TEMPORAL_TASK_QUEUE: DEFAULT_TEMPORAL_TASK_QUEUE,
  REDIS_URL: 'redis://localhost:56379',
} as const;

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COMPOSE_FILE = path.join(REPO_ROOT, 'docker-compose.test.yml');

function docker(args: string[]): void {
  const res = spawnSync('docker', args, { stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error(`docker ${args.join(' ')} exited with ${res.status}`);
  }
}

/**
 * Cycle the test stack: `down -v` first (drops tmpfs volumes), then
 * `up -d --wait`. The cycle gives a guaranteed-empty Postgres so we can use
 * plain `prisma db push` without needing `--force-reset` on an existing DB.
 * Roughly 10-15s per test run; fine for CI and local iteration.
 */
export function composeUp(): void {
  // `down -v` fails if nothing is up, so swallow non-zero on the teardown.
  spawnSync('docker', ['compose', '-f', COMPOSE_FILE, 'down', '-v'], { stdio: 'inherit' });
  // `--wait` respects the temporal healthcheck (default namespace describe),
  // so we don't need a separate readiness poll here.
  docker(['compose', '-f', COMPOSE_FILE, 'up', '-d', '--wait']);
}

/** Bring the stack down and drop volumes. */
export function composeDown(): void {
  docker(['compose', '-f', COMPOSE_FILE, 'down', '-v']);
}

/**
 * Apply the Prisma schema to the test DB. Called once per test run after
 * `composeUp` has produced a fresh Postgres. Refuses to run unless the
 * connection string points at the test port to prevent accidental writes
 * against dev data.
 */
export function resetTestDatabase(): void {
  if (!TEST_STACK_ENV.DATABASE_URL.includes(':55432/')) {
    throw new Error(`Refusing to push schema: ${TEST_STACK_ENV.DATABASE_URL} is not the test DB`);
  }
  const prismaBin = path.join(REPO_ROOT, 'node_modules', '.bin', 'prisma');
  const schemaPath = path.join(REPO_ROOT, 'packages', 'database', 'prisma', 'schema.prisma');
  execFileSync(
    prismaBin,
    ['db', 'push', '--skip-generate', '--schema', schemaPath, '--accept-data-loss'],
    {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: TEST_STACK_ENV.DATABASE_URL },
    },
  );
}
