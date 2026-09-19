import { NestFactory } from '@nestjs/core';
import pino, { type DestinationStream } from 'pino';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';

import { AppModule } from './app.module';
import type { AppConfig } from './platform/config/config';
import { ProblemDetailsFilter } from './platform/http/problem-details.filter';
import { SuccessEnvelopeInterceptor } from './platform/http/success-envelope.interceptor';
import { createValidationPipe } from './platform/http/validation.pipe';
import { createLoggerOptions } from './platform/observability/logger';
import {
  registerRequestContext,
  registerRequestLogging,
} from './platform/observability/observability.plugin';
import {
  createFastifySecurityOptions,
  registerSecurity,
} from './platform/security/security.plugin';

type ApplicationOptions = { loggerDestination?: DestinationStream };

export async function createApplication(
  config: AppConfig,
  options: ApplicationOptions = {},
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    ...createFastifySecurityOptions(config),
    ...(options.loggerDestination
      ? { loggerInstance: pino(createLoggerOptions(config.nodeEnv, config.logLevel), options.loggerDestination) }
      : { logger: createLoggerOptions(config.nodeEnv, config.logLevel) }),
  });
  const fastify = adapter.getInstance();

  // Hook order is part of the platform contract.
  registerRequestContext(fastify);
  registerRequestLogging(fastify);
  await registerSecurity(fastify, config);

  const app = await NestFactory.create<NestFastifyApplication>(AppModule.register(config), adapter, {
    logger: false,
  });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalInterceptors(new SuccessEnvelopeInterceptor());
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.init();
  return app;
}
