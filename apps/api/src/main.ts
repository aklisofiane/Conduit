import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module.js';
import { config } from './config.js';

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
