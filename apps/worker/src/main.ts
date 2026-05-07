import path from 'node:path';
import dotenv from 'dotenv';

// Load the monorepo root .env before any app code reads process.env.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities/index';
import { config } from './config';
import { closeEventBus } from './runtime/event-bus';
import { closePrisma } from './runtime/prisma';
import { dockerPreflight, resolveAgentAuthMode, sweepOrphans } from './runtime/runner';
import { closeTemporalClient } from './runtime/temporal-client';

async function run(): Promise<void> {
  // Docker is a hard requirement — agent execution happens inside per-run
  // agent-runner containers spawned by the worker. Fail fast if Docker
  // isn't reachable, with a message clearer than a silent task-queue stall.
  await dockerPreflight();
  if (resolveAgentAuthMode() === 'oauth-mount') {
    console.warn(
      '[runner] CONDUIT_AGENT_AUTH=oauth-mount active — host ~/.codex/auth.json is bind-mounted into agent containers; do not use in shared/production environments.',
    );
  }
  // Catch containers from a previous worker process whose run already
  // settled to a terminal state. Best-effort; never blocks startup.
  await sweepOrphans().catch((err: unknown) => {
    console.warn(
      'Orphan sweep failed:',
      err instanceof Error ? err.message : String(err),
    );
  });

  const connection = await NativeConnection.connect({ address: config.temporal.address });

  const worker = await Worker.create({
    connection,
    namespace: config.temporal.namespace,
    taskQueue: config.temporal.taskQueue,
    // Temporal bundles the workflow module via Webpack — it wants a path to a
    // real TS/JS file, not a compiled-output path. In dev (ts-node-dev) and
    // prod (compiled dist) this resolves the same entry point.
    workflowsPath: require.resolve('./workflows/index'),
    activities,
  });

  const shutdown = async (): Promise<void> => {
    worker.shutdown();
    await closeEventBus();
    await closePrisma();
    await closeTemporalClient();
    await connection.close();
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  console.log(
    `Conduit worker listening on task queue "${config.temporal.taskQueue}" (${config.temporal.address})`,
  );
  await worker.run();
}

run().catch((err: unknown) => {
  console.error('Worker failed:', err);
  process.exit(1);
});
