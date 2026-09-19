import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApplication } from '../../src/application';
import type { AppConfig } from '../../src/platform/config/config';

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const config: AppConfig = {
  nodeEnv: 'test',
  port: 3000,
  logLevel: 'fatal',
  corsOrigins: ['http://localhost:5173'],
  rateLimitMax: 100,
  rateLimitWindowMs: 60_000,
  healthRateLimitMax: 100,
  trustProxy: false,
  databaseUrl: 'postgresql://postgres:postgres@localhost:5432/test',
  settingsEncryptionKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
};

describe('Control Plane health', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApplication(config);
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['/v1/health/live', '/v1/health/ready'])(
    'serves %s without a provider dependency',
    async (url) => {
      const inboundRequestId = 'client-controlled-request-id';
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { 'x-request-id': inboundRequestId },
      });
      const body = response.json<{
        data: { status: string };
        meta: { requestId: string };
      }>();

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      expect(body.data).toEqual({ status: 'ok' });
      expect(body.meta.requestId).toMatch(UUID_V7_PATTERN);
      expect(response.headers['x-request-id']).toBe(body.meta.requestId);
      expect(body.meta.requestId).not.toBe(inboundRequestId);
    },
  );

  it('returns a correlated Problem Details response for an unknown route', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/unknown?token=query-sentinel' });
    const body = response.json<{
      status: number;
      code: string;
      instance: string;
      requestId: string;
    }>();

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(body).toMatchObject({
      status: 404,
      code: 'ROUTE_NOT_FOUND',
      instance: '/v1/unknown',
      requestId: response.headers['x-request-id'],
    });
    expect(JSON.stringify(body)).not.toContain('query-sentinel');
    expect(body).not.toHaveProperty('data');
  });

  it('maps the health limiter response to correlated Problem Details', async () => {
    const limitedApp = await createApplication({ ...config, healthRateLimitMax: 1 });
    try {
      await limitedApp.inject({ method: 'GET', url: '/v1/health/live' });
      const response = await limitedApp.inject({ method: 'GET', url: '/v1/health/live' });
      const body = response.json<{ code: string; requestId: string }>();

      expect(response.statusCode).toBe(429);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(body.code).toBe('RATE_LIMITED');
      expect(body.requestId).toBe(response.headers['x-request-id']);
      expect(body).not.toHaveProperty('data');
    } finally {
      await limitedApp.close();
    }
  });
});
