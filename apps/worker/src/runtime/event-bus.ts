import { Redis } from 'ioredis';
import { RUN_UPDATES_CHANNEL, type RunUpdateMessage } from '@conduit/shared';
import { config } from '../config';

export type { RunUpdateMessage };

let client: Redis | undefined;

/**
 * Lazy Redis publisher shared across activities in the same worker process.
 * Created on first publish; disposed at worker shutdown.
 */
export async function publishRunUpdate(msg: RunUpdateMessage): Promise<void> {
  client ??= new Redis(config.redis.url, { lazyConnect: false, maxRetriesPerRequest: null });
  await client.publish(RUN_UPDATES_CHANNEL, JSON.stringify(msg));
}

export async function closeEventBus(): Promise<void> {
  await client?.quit().catch(() => undefined);
  client = undefined;
}
