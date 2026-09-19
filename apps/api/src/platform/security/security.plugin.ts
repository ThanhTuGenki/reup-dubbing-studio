import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type {
  FastifyInstance,
  FastifyRequest,
  FastifyServerOptions,
} from 'fastify';

export type SecurityConfig = {
  nodeEnv: string;
  corsOrigins: readonly string[];
  rateLimitMax: number;
  rateLimitWindowMs: number;
  healthRateLimitMax: number;
  trustProxy: NonNullable<FastifyServerOptions['trustProxy']>;
};

export function createFastifySecurityOptions(
  config: Pick<SecurityConfig, 'trustProxy'>,
): FastifyServerOptions {
  return { trustProxy: config.trustProxy };
}

export async function registerSecurity(
  app: FastifyInstance,
  config: SecurityConfig,
): Promise<void> {
  const allowedOrigins = new Set(config.corsOrigins);
  await app.register(helmet);
  await app.register(cors, {
    origin(origin, callback) {
      callback(null, origin === undefined || allowedOrigins.has(origin));
    },
  });
  await app.register(rateLimit, {
    global: true,
    hook: 'onRequest',
    max(request) {
      return isHealthRequest(request) || isSettingsTestRequest(request)
        ? config.healthRateLimitMax
        : config.rateLimitMax;
    },
    timeWindow: config.rateLimitWindowMs,
    keyGenerator(request) {
      const scope = isHealthRequest(request) ? 'health' : isSettingsTestRequest(request) ? 'settings-test' : 'global';
      return `${scope}:${request.ip}`;
    },
    errorResponseBuilder(_request, context) {
      return Object.assign(new Error('Rate limited'), { statusCode: context.statusCode });
    },
  });

  app.addHook('onSend', async (_request, reply) => {
    if (reply.statusCode === 429) reply.type('application/problem+json');
  });
}

function isSettingsTestRequest(request: FastifyRequest): boolean {
  return request.url.split(/[?#]/u, 1)[0]?.startsWith('/v1/settings/tests/') ?? false;
}

function isHealthRequest(request: FastifyRequest): boolean {
  return request.url.split(/[?#]/u, 1)[0]?.startsWith('/v1/health/') ?? false;
}
