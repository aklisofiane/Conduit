import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { RUN_UPDATES_CHANNEL, type RunUpdateMessage } from '@conduit/shared';
import { config } from '../config';

export type { RunUpdateMessage };

/**
 * One Redis connection for publishing, one for subscribing — required by
 * ioredis: subscriber mode blocks the client from other commands. Tiny
 * wrapper so WS gateways and webhook handlers don't reach for ioredis
 * directly.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private pub!: Redis;
  private sub!: Redis;
  private handlers = new Set<(msg: RunUpdateMessage) => void>();

  onModuleInit(): void {
    this.pub = new Redis(config.redis.url, { lazyConnect: false, maxRetriesPerRequest: null });
    this.sub = new Redis(config.redis.url, { lazyConnect: false, maxRetriesPerRequest: null });
    this.sub.subscribe(RUN_UPDATES_CHANNEL).catch(() => undefined);
    this.sub.on('message', (_channel: string, raw: string) => {
      const msg = safeParse(raw);
      if (!msg) return;
      for (const h of this.handlers) h(msg);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.sub.quit().catch(() => undefined);
    await this.pub.quit().catch(() => undefined);
  }

  onRunUpdate(handler: (msg: RunUpdateMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async publishRunUpdate(msg: RunUpdateMessage): Promise<void> {
    await this.pub.publish(RUN_UPDATES_CHANNEL, JSON.stringify(msg));
  }
}

function safeParse(raw: string): RunUpdateMessage | undefined {
  try {
    const m = JSON.parse(raw) as RunUpdateMessage;
    if (typeof m.runId === 'string' && typeof m.nodeName === 'string') return m;
  } catch {
    // fallthrough
  }
  return undefined;
}
