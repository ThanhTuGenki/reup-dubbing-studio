import { Injectable, NestMiddleware } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { createRequestContext, runWithRequestContext } from './request-context';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: IncomingMessage, response: ServerResponse<IncomingMessage>, next: () => void): void {
    const requestIdHeader = request.headers['x-request-id'];
    const requestId = Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader;
    const context = createRequestContext(requestId);

    response.setHeader('x-request-id', context.requestId);
    runWithRequestContext(context, next);
  }
}
