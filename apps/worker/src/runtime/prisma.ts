import { PrismaClient } from '@conduit/database';

/**
 * Module-level Prisma client shared across activities in this worker
 * process. Temporal activities don't expose a DI container, so a singleton
 * is the idiomatic pattern. Disposed from `main.ts` on worker shutdown.
 */
let client: PrismaClient | undefined;

export function prisma(): PrismaClient {
  client ??= new PrismaClient();
  return client;
}

export async function closePrisma(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}
