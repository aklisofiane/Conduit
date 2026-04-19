import 'reflect-metadata';
import path from 'node:path';
import dotenv from 'dotenv';

// Load the monorepo root .env before any app code reads process.env.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import express, { type Request } from 'express';
import { AppModule } from './app.module';
import { config } from './config';

async function bootstrap(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && process.env.WEBHOOK_DEV_SECRET) {
    throw new Error(
      'WEBHOOK_DEV_SECRET must not be set in production — it bypasses HMAC verification.',
    );
  }
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error', 'debug'],
    bodyParser: false,
  });
  // HMAC verification needs the exact bytes GitHub signed. Attach the raw
  // buffer during JSON parsing so the webhook controller can read it. Kept
  // on the Express request object to avoid poking into Nest internals.
  app.use(
    express.json({
      limit: '2mb',
      verify: (req: Request, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(express.urlencoded({ extended: true }));
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
