import { Client, Connection } from '@temporalio/client';
import { config } from '../config';

/**
 * Singleton `@temporalio/client` for activities that need to start *other*
 * workflows (e.g. `pollBoardActivity` kicking off `agentWorkflow` per new
 * match). Separate from the `NativeConnection` the worker uses to poll its
 * own task queue — they're different SDK layers.
 */
let connection: Connection | undefined;
let client: Client | undefined;

export async function getTemporalClient(): Promise<Client> {
  if (client) return client;
  connection ??= await Connection.connect({ address: config.temporal.address });
  client = new Client({ connection, namespace: config.temporal.namespace });
  return client;
}

export async function closeTemporalClient(): Promise<void> {
  await connection?.close();
  connection = undefined;
  client = undefined;
}
