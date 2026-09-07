import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { APP_CONFIG } from '../src/config/config.module';

const testConfig = {
  NODE_ENV: 'test' as const,
  PORT: 0,
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/reup_dubbing_test',
  LOG_LEVEL: 'error' as const,
  CORS_ORIGINS: [],
  SHUTDOWN_TIMEOUT_MS: 1000,
};

describe('GET /health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(testConfig)
      .compile();
    app = await moduleRef
      .createNestApplication<NestFastifyApplication>(new FastifyAdapter())
      .init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a healthy status', () =>
    request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok' }));
});
