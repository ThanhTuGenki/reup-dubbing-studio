import { Writable } from 'node:stream';

import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';

import { createLoggerOptions } from '../../src/platform/observability/logger';
import {
  registerRequestContext,
  registerRequestLogging,
} from '../../src/platform/observability/observability.plugin';
import {
  createFastifySecurityOptions,
  registerSecurity,
} from '../../src/platform/security/security.plugin';

const config = {
  nodeEnv: 'test',
  corsOrigins: ['http://localhost:5173'],
  rateLimitMax: 2,
  rateLimitWindowMs: 60_000,
  healthRateLimitMax: 1,
  trustProxy: false,
} as const;

async function createSecurityApp(): Promise<FastifyInstance> {
  const app = Fastify(createFastifySecurityOptions(config));
  await registerSecurity(app, config);
  app.get('/v1/security-probe', async (request) => ({ ip: request.ip }));
  app.get('/v1/health/live', async () => ({ status: 'ok' }));
  await app.ready();
  return app;
}

describe('platform security integration', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createSecurityApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('adds baseline security headers to HTTP responses', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/security-probe' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });

  it('allows the configured origin during CORS preflight', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/v1/security-probe',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
      },
    });

    expect(response.statusCode).toBeLessThan(400);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers.vary).toContain('Origin');
  });

  it('does not grant CORS permission to an origin outside the allowlist', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/v1/security-probe',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'GET',
      },
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('applies the configured trust-proxy policy to forwarded addresses', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/security-probe',
      headers: { 'x-forwarded-for': '203.0.113.10' },
    });

    expect(createFastifySecurityOptions(config).trustProxy).toBe(config.trustProxy);
    expect(response.json<{ ip: string }>().ip).not.toBe('203.0.113.10');
  });

  it('enforces the global per-client rate limit', async () => {
    const first = await app.inject({ method: 'GET', url: '/v1/security-probe' });
    const second = await app.inject({ method: 'GET', url: '/v1/security-probe' });
    const third = await app.inject({ method: 'GET', url: '/v1/security-probe' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(429);
  });

  it('uses a separate lower limit for health probes', async () => {
    const first = await app.inject({ method: 'GET', url: '/v1/health/live' });
    const second = await app.inject({ method: 'GET', url: '/v1/health/live' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
  });

  it('redacts credentials and the complete query string from observable request logs', async () => {
    const chunks: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    });
    const loggedApp = Fastify({
      trustProxy: config.trustProxy,
      loggerInstance: pino(createLoggerOptions('test', 'info'), destination),
    });
    const observableApp = loggedApp as unknown as FastifyInstance;
    registerRequestContext(observableApp);
    registerRequestLogging(observableApp);
    await registerSecurity(observableApp, config);
    loggedApp.get('/v1/security-log-probe', async () => ({ status: 'ok' }));

    try {
      await loggedApp.inject({
        method: 'GET',
        url: '/v1/security-log-probe?token=query-sentinel',
        headers: {
          authorization: 'Bearer authorization-sentinel',
          cookie: 'session=cookie-sentinel',
        },
      });
    } finally {
      await loggedApp.close();
    }

    const output = chunks.join('');
    expect(output).toContain('[Redacted]');
    expect(output).not.toContain('authorization-sentinel');
    expect(output).not.toContain('cookie-sentinel');
    expect(output).not.toContain('query-sentinel');
  });
});
