import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities/index.js';
import { config } from './config.js';
import { closeEventBus } from './runtime/event-bus.js';
import { closePrisma } from './runtime/prisma.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run(): Promise<void> {
  const connection = await NativeConnection.connect({ address: config.temporal.address });

  const worker = await Worker.create({
    connection,
    namespace: config.temporal.namespace,
    taskQueue: config.temporal.taskQueue,
    // Resolved at runtime via tsx in dev; compiled dist path in production.
    workflowsPath: path.resolve(__dirname, 'workflows/index.js'),
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
