import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
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

type Bucket = { count: number; expiresAt: number };

export function createFastifySecurityOptions(
  config: Pick<SecurityConfig, 'trustProxy'>,
): FastifyServerOptions {
  return { trustProxy: config.trustProxy };
}

export async function registerSecurity(
  app: FastifyInstance,
  config: SecurityConfig,
): Promise<void> {
  const buckets = new Map<string, Bucket>();
  const allowedOrigins = new Set(config.corsOrigins);

  app.addHook('onRequest', async (request, reply) => {
    applyCors(request, reply, allowedOrigins);

    if (request.method === 'OPTIONS') {
      if (request.headers.origin && !allowedOrigins.has(request.headers.origin)) {
        return;
      }
      reply.code(204).send();
      return reply;
    }

    const isHealth = request.url.split(/[?#]/u, 1)[0]?.startsWith('/v1/health/') ?? false;
    const limit = isHealth ? config.healthRateLimitMax : config.rateLimitMax;
    const key = `${isHealth ? 'health' : 'global'}:${request.ip}`;
    const now = Date.now();
    const current = buckets.get(key);
    const bucket = current && current.expiresAt > now
      ? current
      : { count: 0, expiresAt: now + config.rateLimitWindowMs };

    bucket.count += 1;
    buckets.set(key, bucket);
    if (bucket.count > limit) {
      reply.code(429).send({ statusCode: 429, error: 'Too Many Requests' });
      return reply;
    }
  });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Referrer-Policy', 'no-referrer');
  });
}

function applyCors(
  request: FastifyRequest,
  reply: FastifyReply,
  allowedOrigins: ReadonlySet<string>,
): void {
  const origin = request.headers.origin;
  if (!origin || !allowedOrigins.has(origin)) return;

  reply.header('Access-Control-Allow-Origin', origin);
  reply.header('Vary', 'Origin');
  if (request.method === 'OPTIONS') {
    reply.header('Access-Control-Allow-Methods', request.headers['access-control-request-method'] ?? 'GET');
    reply.header('Access-Control-Allow-Headers', request.headers['access-control-request-headers'] ?? 'Content-Type');
  }
}
