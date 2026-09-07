import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import {
  createRequestContext,
  runWithRequestContext,
} from './request-context';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const requestIdHeader = request.headers['x-request-id'];
    const requestId = Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader;
    const context = createRequestContext(requestId);

    response.setHeader('x-request-id', context.requestId);
    runWithRequestContext(context, next);
  }
}
