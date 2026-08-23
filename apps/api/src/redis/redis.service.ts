import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { RUN_UPDATES_CHANNEL, type RunUpdateMessage } from '@conduit/shared';
import { config } from '../config';

export type { RunUpdateMessage };

/**
 * Better Auth's `secondaryStorage` interface. Reproduced here rather than
 * imported so we don't take a build-time dependency on `@better-auth/core`
 * (a nested dependency of `better-auth`, not a direct one). Kept structurally
 * compatible with the upstream shape — `auth.config.ts` passes the result of
 * `createBetterAuthRedisStorage` straight into `betterAuth({ secondaryStorage })`,
 * so any drift shows up as a typecheck failure there.
 */
export interface BetterAuthSecondaryStorage {
  get(key: string): Promise<string | null>;
  getAndDelete(key: string): Promise<string | null>;
  increment(key: string, ttl: number): Promise<number>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * `INCR`, then set the expiry only on the call that created the key, so the
 * counter expires a fixed window after it was *first* incremented rather than
 * sliding forward on every hit. Lua keeps that read-modify-write atomic across
 * API processes — which is the whole point of putting rate-limit counters in
 * Redis instead of in-process memory.
 */
const INCREMENT_WITH_TTL = `
local value = redis.call('INCR', KEYS[1])
if value == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return value
`;

/**
 * Adapt an `ioredis` client to Better Auth's `secondaryStorage` shape. Used
 * for both rate-limit counter storage and the session cache. Lives next to
 * the Redis client (not in `auth/`) so the Redis adapter logic lives with
 * the rest of the Redis surface.
 *
 * All `ttl`s are in seconds (Better Auth's contract). `set` forwards to
 * `EX` — a missing ttl writes a key without expiry, which is what Better
 * Auth wants for non-rate-limit values.
 */
export function createBetterAuthRedisStorage(redis: Redis): BetterAuthSecondaryStorage {
  return {
    async get(key) {
      return redis.get(key);
    },
    async getAndDelete(key) {
      // Redis 8 (see `docker-compose*.yml`); `GETDEL` landed in 6.2.
      return redis.getdel(key);
    },
    async increment(key, ttl) {
      // Better Auth only ever calls this for rate-limit windows, which are
      // always positive — the floor is belt-and-braces against `EXPIRE 0`
      // deleting the key it just created.
      const seconds = Math.max(1, Math.floor(ttl));
      const value = await redis.eval(INCREMENT_WITH_TTL, 1, key, String(seconds));
      return Number(value);
    },
    async set(key, value, ttl) {
      if (typeof ttl === 'number' && ttl > 0) {
        await redis.set(key, value, 'EX', ttl);
      } else {
        await redis.set(key, value);
      }
    },
    async delete(key) {
      await redis.del(key);
    },
  };
}

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

  /**
   * Return a Better Auth-compatible `secondaryStorage` that reuses the
   * publisher connection. Better Auth uses this for rate-limit counters and
   * (optionally) session cache reads — both fit within the publisher
   * client's command surface (no pub/sub interference).
   */
  betterAuthSecondaryStorage(): BetterAuthSecondaryStorage {
    return createBetterAuthRedisStorage(this.pub);
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
