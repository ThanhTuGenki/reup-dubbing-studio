import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infra/prisma/prisma.service';

describe('GET /health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
    app = await moduleRef
      .createNestApplication<NestFastifyApplication>(new FastifyAdapter())
      .init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a healthy status and echoes a supplied request id', () =>
    request(app.getHttpServer())
      .get('/health')
      .set('x-request-id', 'abc')
      .expect(200)
      .expect('x-request-id', 'abc')
      .expect({ status: 'ok' }));

  it('generates a request id when one is not supplied', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
