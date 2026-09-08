import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');

import { PrismaService } from '../src/infra/prisma/prisma.service';

describe('GET /health', () => {
  let app: INestApplication;
  let stdout = '';
  let stdoutSpy: jest.SpyInstance;
  const previousEnvironment = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    stdoutSpy = jest.spyOn(process, 'stdout', 'get').mockReturnValue({
      write: (chunk: string | Uint8Array) => {
        stdout += chunk.toString();
        return true;
      },
    } as typeof process.stdout);
    const { AppModule } = await import('../src/app.module');
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
    stdoutSpy.mockRestore();
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
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

  it('redacts credentials in the log for a real request', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .set('Authorization', 'Bearer AUTHORIZATION_E2E_SENTINEL')
      .set('Cookie', 'session=COOKIE_E2E_SENTINEL')
      .expect(200);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(stdout).not.toContain('AUTHORIZATION_E2E_SENTINEL');
    expect(stdout).not.toContain('COOKIE_E2E_SENTINEL');
    expect(stdout).toContain('[Redacted]');
  });
});
