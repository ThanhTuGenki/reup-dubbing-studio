import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { formatConfigError, parseEnv } from './config/env.schema';

async function bootstrap() {
  const config = parseEnv();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

  app.enableShutdownHooks(['SIGTERM'], { useProcessExit: true });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(config.PORT, '0.0.0.0');
}

void bootstrap().catch((error: unknown) => {
  process.stderr.write(`Invalid configuration:\n${formatConfigError(error)}\n`);
  process.exit(1);
});
