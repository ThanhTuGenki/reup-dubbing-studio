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
});
