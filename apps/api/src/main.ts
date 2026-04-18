import 'reflect-metadata';
import path from 'node:path';
import dotenv from 'dotenv';

// Load the monorepo root .env before any app code reads process.env.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';
import { config } from './config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error', 'debug'],
  });
  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.corsOrigin, credentials: true });
  app.useWebSocketAdapter(new IoAdapter(app));
  app.enableShutdownHooks();

  await app.listen(config.port);
  new Logger('bootstrap').log(`Conduit API listening on :${config.port}`);
}

bootstrap().catch((err: unknown) => {
  console.error('API bootstrap failed:', err);
  process.exit(1);
});
