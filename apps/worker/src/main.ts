import path from 'node:path';
import dotenv from 'dotenv';

// Load the monorepo root .env before any app code reads process.env.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities/index';
import { config } from './config';
import { closeEventBus } from './runtime/event-bus';
import { closePrisma } from './runtime/prisma';

async function run(): Promise<void> {
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
