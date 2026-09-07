import {
  BeforeApplicationShutdown,
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';

import { InjectAppConfig } from '../../config/config.module';
import { AppConfig } from '../../config/env.schema';

@Injectable()
export class ShutdownService
  implements OnModuleInit, BeforeApplicationShutdown, OnApplicationShutdown
{
  private draining = false;
  private timeout?: NodeJS.Timeout;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    @InjectAppConfig() private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    const fastify = this.httpAdapterHost.httpAdapter.getInstance<FastifyInstance>();
    fastify.addHook('onRequest', (_request, reply, done) => {
      if (this.draining) {
        void reply.code(503).send({ status: 'shutting_down' });
        return;
      }

      done();
    });
  }

  beforeApplicationShutdown() {
    this.draining = true;
    this.timeout = setTimeout(() => process.exit(1), this.config.SHUTDOWN_TIMEOUT_MS);
    this.timeout.unref();
  }

  onApplicationShutdown() {
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
  }
}
