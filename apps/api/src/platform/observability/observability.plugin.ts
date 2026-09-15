import type { FastifyInstance, FastifyRequest } from 'fastify';

import { createRequestContext, requestContextStorage } from './request-context';

type ContextRequest = FastifyRequest & { requestId?: string };

export function registerRequestContext(app: FastifyInstance): void {
  app.addHook('onRequest', (request, reply, done) => {
    const context = createRequestContext({
      method: request.method,
      route: request.url,
    });
    const contextRequest = request as ContextRequest;
    contextRequest.requestId = context.requestId;
    reply.header('X-Request-Id', context.requestId);
    requestContextStorage.run(context, done);
  });
}
