import { PrismaClient } from '@prisma/client';

export { PrismaClient };
export * from '@prisma/client';

let _client: PrismaClient | undefined;

/**
 * Singleton Prisma client. Apps import `prisma` for shared connection pooling.
 * Use a new `PrismaClient()` directly when you need an isolated client (tests).
 */
export const prisma: PrismaClient = (() => {
  if (!_client) {
    _client = new PrismaClient();
  }
  return _client;
})();
