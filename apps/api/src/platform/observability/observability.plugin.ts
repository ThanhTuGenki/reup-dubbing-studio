import type { FastifyInstance, FastifyRequest } from 'fastify';

import { createRequestContext, requestContextStorage } from './request-context';

type ContextRequest = FastifyRequest & { requestId?: string; id: string };

export function registerRequestContext(app: FastifyInstance): void {
  app.addHook('onRequest', (request, reply, done) => {
    const context = createRequestContext({
      method: request.method,
      route: request.url,
    });
    const contextRequest = request as ContextRequest;
    contextRequest.requestId = context.requestId;
    contextRequest.id = context.requestId;
    reply.header('X-Request-Id', context.requestId);
    requestContextStorage.run(context, done);
  });
}

export function registerRequestLogging(app: FastifyInstance): void {
  app.addHook('onResponse', async (request, reply) => {
    const contextRequest = request as ContextRequest;
    request.log.info({
      requestId: contextRequest.requestId,
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
    }, 'request completed');
  });
}
